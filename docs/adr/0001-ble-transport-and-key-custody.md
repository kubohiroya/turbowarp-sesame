# ADR 0001: BLE transport and browser-side key custody

[日本語](0001-ble-transport-and-key-custody.ja.md)

- **Status:** Proposed
- **Date:** 2026-09-16
- **Supersedes:** none
- **Affects:** `src/transport.ts`, `src/sesame-client.ts`, `src/relay-client.ts`, `src/extension.ts`, `@kubohiroya/keybroker`

## Context

Both existing transports terminate at the Candy House cloud. Direct mode holds the API key, device
UUID, and 32-character hexadecimal secret on the extension instance, where block literals can be
persisted into the `.sb3` file. Relay mode removes that exposure by moving the credentials to a
localhost broker, at the cost of requiring a separate daemon and an unsandboxed extension load.

CANDY HOUSE publishes the complete SesameOS3 Bluetooth LE protocol under the MIT license. The
relevant facts for this decision:

- BLE service `0xFD81`; Tx characteristic `16860002-a5ae-9856-b6d3-dbb4c676993e` (write without
  response), Rx characteristic `16860003-a5ae-9856-b6d3-dbb4c676993e` (notify).
- On connect the device publishes a four-byte `random_code`. The session token is
  `AES_CMAC(device_secret, random_code)`. Payloads are then AES-CCM with a 13-byte IV
  (`count(8) || 0x00 || random_code(4)`) and a four-byte tag.
- Commands are single-byte item codes: `82` lock, `83` unlock, `81` mech status, `4` history.
- `mech_status` is pushed unsolicited (`type = 0x08`) whenever the physical state changes.

The 16-byte BLE `device_secret` is the same value the Web API already requires: the sesame app's
share QR code (`ssm://UI?t=sk&sk=<base64>`) decodes to `0x05` followed by those 16 bytes, and that
is what `SesameClient` passes to `aesCmac` today. A BLE transport therefore needs no new credential
from the user.

A BLE path removes the cloud round trip, works without WiFi Module 2, reports genuine mechanical
state instead of cloud acknowledgement, and adds physical Bluetooth proximity as a factor an
attacker must also satisfy. It also raises a question the HTTP transports never had to answer: the
browser itself would hold a door key.

## Decision

### 1. `BleTransport` as a third `SesameTransport`

`src/transport.ts` already defines the seam. `BleTransport` joins `SesameClient` and `RelayClient`
as an implementation. For clarity the existing two are renamed `CloudApiTransport` and
`BrokerTransport`.

The contract is widened in three ways, because BLE has capabilities and constraints that HTTP does
not:

- `capabilities(): ReadonlySet<TransportCapability>` — `getHistory(page, length)` does not map onto
  BLE, whose history is a pop-style pull of one record at a time via item code `4` with an
  `is_peek` flag, with no pagination. Callers must be able to ask before invoking.
- Optional `connect()` / `close()` — BLE carries connection state (connect, enable notify, receive
  `random_code`, login) that the HTTP transports do not.
- Optional `onStatusChange(listener)` — surfaces the unsolicited `mech_status` publish. This is a
  capability the cloud transports cannot provide and is the most valuable one for a Scratch
  audience, as it makes a hat block possible.

### 2. The device secret is never raw bytes in the JavaScript heap

The BLE protocol never requires the `device_secret` itself, only AES operations keyed by it:

1. `AES_CMAC(device_secret, random_code)` decomposes into single-block AES encryptions, which a
   non-extractable `AES-CBC` key performs. `src/aes-cmac.ts` already imports with
   `extractable: false`.
2. The resulting 16-byte token is re-imported as a non-extractable key and used for AES-CCM, which
   is built from AES-CTR plus CBC-MAC because Web Crypto offers no CCM mode.

`CryptoKey` is structured-cloneable, so the key object is stored in IndexedDB directly. The user
pastes the hexadecimal secret once during pairing; it is imported with `extractable: false` and the
string is discarded. `exportKey()` then throws for the lifetime of the record.

### 3. The keyholder origin, not the TurboWarp origin, is the custody boundary

Non-extractability prevents reading the key but not using it. Any script on the same origin can
call `subtle.encrypt` with the stored `CryptoKey` and open the door. That origin would be
`https://turbowarp.org`, shared with every other custom extension and project the user ever loads —
a weaker boundary than the broker's.

The key therefore lives in a cross-origin iframe served from a project-controlled origin (the
keyholder). TurboWarp's page cannot read that origin's IndexedDB.

```text
TurboWarp page (turbowarp.org)        keyholder iframe (project origin)
  BleTransport                          CryptoKey in IndexedDB
    | postMessage: "lock, tag=..."  ->  AES-CMAC, AES-CCM, segmentation
    | <- encrypted BLE frames
  GATT write to Tx  ------------------------------------> Sesame
  GATT notify from Rx
    | postMessage: raw bytes        ->  decrypt, parse
    | <- { itemCode, payload }
```

Web Bluetooth stays in the parent: the `bluetooth` Permissions Policy has a default allowlist of
`self`, and TurboWarp will not emit `allow="bluetooth"` on the frame. This is acceptable because
the parent becomes a byte pipe that sees neither keys nor plaintext.

This is the broker architecture with the origin substituted for localhost as the isolation
boundary. It preserves the same invariant — credentials never reach the client — and the same
ability to enforce policy in the trusted component (confirmation before unlock, rate limiting,
lock-only mode), without requiring a daemon installation.

### 4. Use is gated by user verification

The keyholder stores the secret wrapped, not directly usable. A key-encryption key is derived from
the WebAuthn PRF extension (`navigator.credentials.get` with `extensions.prf`), run through HKDF,
and used to `unwrapKey` into a memory-only non-extractable `CryptoKey`. Every session therefore
requires a platform authenticator gesture, matching the official app's biometric prompt, and the
stored blob alone is worthless. PRF is available in Chrome/Edge, Safari 18 or later on macOS 15 or
later, and Firefox 147 or later. Where it is unavailable, fall back to a PBKDF2 passphrase wrap.

### 5. `@kubohiroya/capability-proxy` is renamed `@kubohiroya/keybroker`

"A localhost-first relay that exposes named capabilities without giving provider credentials to
clients" is, in standard terminology, a credential broker. The previous name conveyed no
information about what is brokered. The renamed package keeps its role as the cloud Web API path,
which remains necessary for remote operation, for browsers without Web Bluetooth, and for control
from outside Bluetooth range.

### 6. Pairing reads the app's share QR code, in a top-level keyholder window

The sesame app shares a key as a QR code holding an `ssm://UI` URL. Its `sk`
form is self-contained and needs no server:

```text
ssm://UI?t=sk&sk=<base64>&l=<key level>&n=<device name>
```

The base64 value decodes to a packed record. Its shape depends on the product
model in its first byte, because SESAME 5 and later carry a four-byte public
key where earlier models carry sixty-four:

```text
model >= 5   [0] model | [1..16] secret | [17..20] public key  | [21..22] key index | [23..38] UUID
model <  5   [0] model | [1..16] secret | [17..80] public key  | [81..82] key index | [83..98] UUID
```

Those sixteen secret bytes are the `device_secret` decision 2 describes, and
the UUID is the same device UUID the Web API uses. Scanning therefore replaces
the whole manual credential step: no hexadecimal to copy, no UUID to paste, and
the right public key for the model comes along with it.

**The scan happens in a top-level window on the keyholder origin, not in the
iframe and not in TurboWarp's page.** The QR carries the secret in cleartext,
so a page that decodes it holds the secret; letting TurboWarp's page do that
would undo decision 3. The iframe cannot do it either: the `camera` Permissions
Policy defaults to an allowlist of `self`, exactly as `bluetooth` does, and
TurboWarp emits no `allow="camera"`. A top-level browsing context on the
keyholder origin is its own `self`, so the camera works there. Pairing opens
that window, scans, imports the secret as a non-extractable `CryptoKey`, wraps
it, and closes; the extension learns only a device name and that pairing
succeeded. Sessions afterwards run through the iframe, which needs no camera.

Decoding uses `BarcodeDetector` where the platform provides it — macOS,
Android, and ChromeOS — and a bundled decoder elsewhere, since Chrome on
Windows and Linux has no platform barcode support. Either way the video frames
stay inside the keyholder.

### 7. The key level in the QR code is advisory, and policy is stored separately

The app offers owner, manager, and guest QR codes. The level travels as the
`l` query parameter — `0`, `1`, or `2` — alongside the payload rather than
inside it. It is neither encrypted nor authenticated, and the Bluetooth
protocol has no concept of it: item codes `82` and `83` are accepted from
anyone holding a valid session. What actually differs between levels in the
published SDK is _which_ secret the payload carries, because sharing a guest
key substitutes a separate guest secret into the record.

So the keyholder records `l` to show the user which kind of key was scanned and
must not treat it as a permission. Any restriction this project enforces —
confirmation before unlock, a lock-only mode, rate limiting — belongs to policy
the keyholder stores next to the key, applied to every key regardless of level.

The app can also present a short-lived encrypted sharing code. The published
SDK defines two further QR types beside `sk` (`friend` and `matter`) and a
separate `invite` parameter, but not the encoding of a time-limited code, so
this project does not attempt to read one. A code that expires necessarily has
a server deciding whether it is still valid, which is the dependency the
Bluetooth path exists to remove. Where only such a code is available, the
answer is to export an `sk` code instead, or to use the broker.

## Consequences

### Gained

- No credential is written into the `.sb3` file in any mode.
- Operation without the Candy House cloud, without WiFi Module 2, and without a daemon install.
- Genuine mechanical state via `mech_status` push, replacing cloud acknowledgement, which does not
  prove the lock physically moved.
- Physical Bluetooth proximity becomes a factor an attacker must also satisfy.
- Lower latency than the cloud round trip.
- Pairing by scanning the app's share QR code, which replaces copying a
  hexadecimal secret and a device UUID by hand and cannot transcribe them
  wrongly.

### Given up or newly required

- **Browser reach narrows.** Web Bluetooth exists only in Chrome, Edge, and Chromium derivatives on
  desktop and Android. Safari, Firefox, and all of iOS are excluded. The broker path remains the
  answer for those users.
- **Sandboxed execution is no longer possible** on the BLE path: a sandboxed extension runs in an
  opaque origin, where IndexedDB is unavailable and Web Bluetooth is blocked. Direct mode's
  sandbox-compatibility advantage is traded for keeping credentials out of the project file, which
  is the larger win.
- **AES-CCM must be implemented by hand** on AES-CTR and CBC-MAC, roughly a hundred lines in the
  style of the existing `src/aes-cmac.ts`.
- **`requestDevice()` requires transient user activation**, so pairing needs an explicit connect
  block run immediately after a click rather than an implicit connection on first command.
- **The key is confined to one browser profile.** Clearing browsing data erases it, private windows
  do not retain it, and it does not sync across devices. A re-pairing flow is required, and the
  keyholder must degrade clearly rather than failing opaquely.
- **Same-origin use remains possible in principle.** The iframe origin and the PRF gate reduce the
  window; they do not eliminate it. A compromise of the keyholder origin during an authenticated
  session can still drive the lock.
- **Barcode decoding needs a bundled decoder on Windows and Linux**, where
  Chrome has no platform barcode support behind `BarcodeDetector`.
- **Time-limited sharing codes are not supported**, only the self-contained
  `sk` form. Their encoding is not in the published SDK, and redeeming one
  would reintroduce a server.
- **Non-extractable is not hardware-backed.** The key material lives in the browser profile on
  disk, protected by file permissions and full-disk encryption only. An attacker with the user's
  unlocked machine wins — as they also would with the broker's configuration file or with the phone
  running the official app.

## Alternatives considered

**Store the key in IndexedDB on `turbowarp.org` directly.** Rejected. Simplest to build, but the
origin is shared with every extension and project the user loads, so a non-extractable key can
still be driven by unrelated code.

**Run Web Bluetooth entirely inside the keyholder iframe.** Rejected as impossible: the `bluetooth`
Permissions Policy defaults to `self` and requires the top-level document to grant
`allow="bluetooth"`, which TurboWarp does not do.

**Add BLE to the broker instead, using a native stack.** Viable — Node's `@abandonware/noble` or
Python's `bleak`, with AES-CCM available natively in Node's `crypto` as `aes-128-ccm`, avoiding the
hand-rolled implementation. Rejected as the primary path because it reintroduces the daemon
installation the BLE route is meant to remove. Retained as a future option for headless and
non-Chromium environments.

**Implement BLE registration.** Rejected as out of scope. Registration requires secp256r1 ECDH key
exchange to derive a new `device_secret`. Reusing the existing share-QR secret via the login path
avoids that entirely, matching how `libsesame3bt` operates with `set_keys("", SECRET)`.

## References

- [CANDY-HOUSE Sesame Bluetooth API document](https://github.com/CANDY-HOUSE/Sesame_BluetoothAPI_document) (MIT)
- [SesameOS3/bluetooth.ja.md](https://github.com/CANDY-HOUSE/API_document/blob/master/SesameOS3/bluetooth.ja.md)
- [libsesame3bt-core](https://github.com/homy-newfs8/libsesame3bt-core)
- [Permissions-Policy: bluetooth](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/bluetooth)
- [WebAuthn PRF extension](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions)
- [SesameSDK iOS `URL+Sesame2.swift`](https://github.com/CANDY-HOUSE/SesameSDK_iOS_with_DemoApp/blob/master/SesameUI/Shared/Extensions/URL%2BSesame2.swift) — share QR encoding
- [SesameSDK iOS `KeyLevel.swift`](https://github.com/CANDY-HOUSE/SesameSDK_iOS_with_DemoApp/blob/master/SesameUI/Shared/Util/KeyLevel.swift) — owner, manager, guest
- [Permissions-Policy: camera](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/camera)
- [Barcode Detection API](https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API)
- [NIST SP 800-38C](https://csrc.nist.gov/pubs/sp/800/38/c/upd1/final) and [RFC 3610](https://www.rfc-editor.org/rfc/rfc3610) — AES-CCM
