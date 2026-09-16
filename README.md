# TurboWarp-Sesame

[English](README.md) | [日本語](README.ja.md)

A TurboWarp extension for inspecting Candy House Sesame devices and, in explicitly enabled builds,
requesting remote lock operations. It supports Direct mode and a localhost Relay mode that keeps
provider credentials out of TurboWarp projects.

**User guide:** [English](https://kubohiroya.github.io/turbowarp-sesame/)

## What it does

- Reads lock state, battery level, angle, timestamp, and Wi-Fi module state.
- Retrieves recent Sesame history as JSON.
- Can request lock, unlock, and toggle operations in a build where the safety flag is enabled.
- Reports configuration and API failures through a block instead of stopping the project.
- Pairs with `@kubohiroya/keybroker` using a short-lived one-time code.
- Controls the lock directly over Bluetooth LE, with no cloud and no WiFi Module 2.
- Runs a hat block when the lock reports that it moved, which only Bluetooth can report.

## Requirements and safety

- Recommended for Bluetooth: Chrome or Edge on desktop or Android, and an owner or manager sharing QR code.
- Recommended for the cloud: a localhost `@kubohiroya/keybroker`, a device alias, and its one-time code.
- Direct mode: a Candy House API key, Sesame UUID, and 32-character hexadecimal secret key.
- A Sesame device reachable through the Candy House cloud, such as through WiFi Module 2.
- A browser with `fetch`, `TextEncoder`, and Web Crypto AES-CBC support.
- Direct mode can run in the TurboWarp sandbox.
- Relay mode must be loaded with **Run extension without sandbox** enabled because browsers restrict localhost access from sandboxed iframes.

> [!CAUTION]
> Values typed into Direct mode blocks are stored in the `.sb3` project. Never publish or share a
> project containing real credentials. Relay mode does not pass the API key or secret to TurboWarp;
> the paired Relay token stays only in extension runtime memory.

Remote lock commands are disabled in default builds. A command accepted by the cloud does not prove
that the physical lock moved; read the status again to confirm the result.

## Installation

1. Download [`dist/turbowarp-sesame.js`](dist/turbowarp-sesame.js?raw=1).
2. Open **Extensions** in TurboWarp.
3. Choose **Custom Extension**. Keep sandboxing enabled for Direct mode; enable **Run extension without sandbox** for Relay mode.

The reviewed JavaScript build is committed to this repository, so users do not need a build
environment.

For package consumers:

```bash
pnpm add --save-exact @kubohiroya/turbowarp-sesame@0.1.0
```

```text
node_modules/@kubohiroya/turbowarp-sesame/dist/turbowarp-sesame.js
```

## Relay mode (recommended)

1. Start [`@kubohiroya/keybroker`](https://github.com/kubohiroya/keybroker) on localhost.
2. Load the custom extension with **Run extension without sandbox** enabled. Chrome and other browsers can deny localhost access from TurboWarp's sandbox iframe.
3. Configure its endpoint and the device alias defined in the Relay configuration.
4. Enter the eight-digit code printed by the Relay into the pairing block.
5. Read status or history. Pair again after restarting the Relay.

```text
configure local Relay [http://127.0.0.1:8787] device alias [front-door]
pair local Relay with one-time code (...)
say (Sesame status [CHSesame2Status])
clear Sesame connection
```

The endpoint and alias are not secrets. The pairing code works once within five minutes, and the
resulting token is never written to a block or `.sb3` file.

## Standalone app (`turbowarp-sesame-app.sb3`)

One file, no server, no extension to load by hand.

1. Download
   <https://kubohiroya.github.io/turbowarp-sesame/turbowarp-sesame-app.sb3>.
2. Open it at [turbowarp.org](https://turbowarp.org). The extension travels
   inside the file as a `data:` URL, so nothing is fetched.
3. When TurboWarp asks whether to load the custom extension, **tick "run
   without sandbox"** and allow it. Web Bluetooth is unavailable inside the
   sandbox, and TurboWarp remembers the choice.
4. Open the keyholder page and pair an owner or manager key.
5. Back in the project: SPACE connects, L locks, U unlocks.

> [!IMPORTANT]
> This build has lock control **enabled**, unlike
> `dist/turbowarp-sesame.js`, which keeps it off. That is the only difference
> between the two: the extension ID and every opcode are identical, so a
> project works with either.
>
> The file still cannot open anything on its own. It holds no device secret,
> no API key, and no token. Control requires pairing a sharing QR code in the
> keyholder, on its own origin, behind a passkey or passphrase — and being
> within Bluetooth range of the lock.

`scripts/build-sb3.mjs` fails the build if any credential appears in the file,
and `tests/app-sb3.test.ts` checks the same properties on the built artifact.

Running this against a real lock for the first time?
[Testing against a real Sesame](docs/device-testing.md) is the step-by-step
procedure, including what has not been verified yet.

Use the web version rather than TurboWarp Desktop: Electron needs its own
Bluetooth device-chooser handling, which the desktop app does not provide.

## Bluetooth mode

Talks to the lock directly. No Candy House cloud, no WiFi Module 2, and genuine
mechanical state instead of a cloud acknowledgement.

```text
configure Bluetooth keyholder [https://.../keyholder/] device alias [front-door]
pair Sesame by scanning its sharing QR code
connect to Sesame over Bluetooth
when the Sesame state changes
say (Sesame status [CHSesame2Status])
```

The device secret never reaches TurboWarp. It lives in the keyholder page on its
own origin, which seals every frame before this extension writes it to the lock.
The page is in [`docs/keyholder/`](docs/keyholder/) and contacts no server;
pairing and unlocking happen entirely in the browser. See
[ADR 0001](docs/adr/0001-ble-transport-and-key-custody.md).

Notes:

- Requires **Run extension without sandbox**, and Chrome or Edge on desktop or
  Android. Safari, Firefox, and iOS have no Web Bluetooth; use Relay mode there.
- Run `connect to Sesame over Bluetooth` straight after a click. The browser's
  device chooser needs a recent user gesture.
- Share an **owner or manager** key. A guest key has half of its secret withheld
  by the server and cannot open a Bluetooth session at all.
- History is unavailable over Bluetooth, which has no paginated history.
- Keys are kept in one browser profile on the keyholder's origin. Clearing site
  data erases them, and they do not sync between devices.
- Host the keyholder on a domain of its own where you can. On a shared host such
  as `*.github.io`, every other page on that host shares the origin, and no
  response headers can be set so any site may embed it. See
  [Hosting the keyholder](docs/keyholder-hosting.md).

## Direct mode

Obtain credentials from the Candy House developer portal and run the Direct configuration block.
This compatibility mode is useful when a local Relay cannot be run, but saved block inputs may
remain in the `.sb3` file.

## Block reference

This section is generated from [`src/block-definitions.json`](src/block-definitions.json).

<!-- BEGIN GENERATED BLOCKS -->

### `configure Direct mode API key [API_KEY] UUID [UUID] secret key [SECRET_KEY]`

Selects Direct mode and keeps the Candy House credentials in memory until they are cleared or the extension reloads.

| Property     | Value                                                   |
| ------------ | ------------------------------------------------------- |
| Type         | Command                                                 |
| Opcode       | `configure`                                             |
| `API_KEY`    | String, default: `api-key`                              |
| `UUID`       | String, default: `00000000-0000-0000-0000-000000000000` |
| `SECRET_KEY` | String, default: `00000000000000000000000000000000`     |

### `configure local Relay [ENDPOINT] device alias [DEVICE_ALIAS]`

Selects Relay mode for a localhost keybroker without storing Candy House credentials in the project.

| Property       | Value                                    |
| -------------- | ---------------------------------------- |
| Type           | Command                                  |
| Opcode         | `configureRelay`                         |
| `ENDPOINT`     | String, default: `http://127.0.0.1:8787` |
| `DEVICE_ALIAS` | String, default: `front-door`            |

### `pair local Relay with one-time code [CODE]`

Exchanges an eight-digit one-time code for a Relay token held only in extension memory.

| Property | Value                       |
| -------- | --------------------------- |
| Type     | Command                     |
| Opcode   | `pairRelay`                 |
| `CODE`   | String, default: `00000000` |

### `configure Bluetooth keyholder [KEYHOLDER_URL] device alias [DEVICE_ALIAS]`

Selects Bluetooth mode. The keyholder page holds the device secret on its own origin, so no credential is stored in the project.

| Property        | Value                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| Type            | Command                                                                     |
| Opcode          | `configureBluetooth`                                                        |
| `KEYHOLDER_URL` | String, default: `https://kubohiroya.github.io/turbowarp-sesame/keyholder/` |
| `DEVICE_ALIAS`  | String, default: `front-door`                                               |

### `pair Sesame by scanning its sharing QR code`

Opens the keyholder so it can scan an owner or manager sharing QR code from the sesame app. Guest codes cannot work over Bluetooth.

| Property | Value           |
| -------- | --------------- |
| Type     | Command         |
| Opcode   | `pairBluetooth` |

### `connect to Sesame over Bluetooth`

Opens the browser's device chooser and logs in. Run this straight after a click, because the chooser needs a recent user gesture.

| Property | Value              |
| -------- | ------------------ |
| Type     | Command            |
| Opcode   | `connectBluetooth` |

### `Sesame Bluetooth connected?`

Reports whether a Bluetooth session is logged in and usable.

| Property | Value                |
| -------- | -------------------- |
| Type     | Boolean              |
| Opcode   | `bluetoothConnected` |

### `when the Sesame state changes`

Runs when the lock reports that it moved. Only Bluetooth reports this; the cloud modes cannot.

| Property | Value              |
| -------- | ------------------ |
| Type     | Hat                |
| Opcode   | `whenStateChanges` |

### `clear Sesame connection`

Removes Direct credentials or the local Relay session held by the running extension.

| Property | Value              |
| -------- | ------------------ |
| Type     | Command            |
| Opcode   | `clearCredentials` |

### `Sesame connection ready?`

Reports whether Direct credentials or a paired Relay session are currently held in memory.

| Property | Value          |
| -------- | -------------- |
| Type     | Boolean        |
| Opcode   | `isConfigured` |

### `local Relay paired?`

Reports whether the current Relay connection has an in-memory session token.

| Property | Value         |
| -------- | ------------- |
| Type     | Boolean       |
| Opcode   | `relayPaired` |

### `Sesame connection mode`

Reports direct, relay, or not configured.

| Property | Value            |
| -------- | ---------------- |
| Type     | Reporter         |
| Opcode   | `connectionMode` |

### `Sesame status [FIELD]`

Fetches one field from the current Sesame status.

| Property | Value                              |
| -------- | ---------------------------------- |
| Type     | Reporter                           |
| Opcode   | `getStatusField`                   |
| `FIELD`  | String, default: `CHSesame2Status` |

### `Sesame history page [PAGE] length [LENGTH]`

Fetches up to 50 history records as a JSON string.

| Property | Value                 |
| -------- | --------------------- |
| Type     | Reporter              |
| Opcode   | `getHistory`          |
| `PAGE`   | Number, default: `0`  |
| `LENGTH` | Number, default: `10` |

### `Sesame [COMMAND] with history [HISTORY]`

Requests a lock, unlock, or toggle operation when remote commands are enabled in the build.

| Property  | Value                        |
| --------- | ---------------------------- |
| Type      | Command                      |
| Opcode    | `sendCommand`                |
| `COMMAND` | String, default: `lock`      |
| `HISTORY` | String, default: `TurboWarp` |

### `Sesame remote commands enabled?`

Reports the build-time safety flag for remote lock commands.

| Property | Value             |
| -------- | ----------------- |
| Type     | Boolean           |
| Opcode   | `commandsEnabled` |

### `last Sesame error`

Reports the most recent configuration or API error without exposing credentials.

| Property | Value       |
| -------- | ----------- |
| Type     | Reporter    |
| Opcode   | `lastError` |

<!-- END GENERATED BLOCKS -->

## Important behavior

| Situation                                    | Behavior                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Credentials are invalid                      | The previous valid configuration is retained and `last Sesame error` explains the failure. |
| API or network request fails                 | The block returns an empty value or `[]`; the project continues and the error is recorded. |
| Remote command flag is OFF                   | No command request is sent.                                                                |
| Remote command is accepted                   | Re-read status to verify that the physical device moved.                                   |
| Credentials are cleared or extension reloads | In-memory credentials are discarded.                                                       |

## Enabling remote commands

Remote commands are intentionally fixed OFF in [`config/feature-flags.ts`](config/feature-flags.ts).
Review the source and security implications, change `sesameCommands` to `true`, and rebuild locally
only when physical lock control is intended. Never distribute an enabled build without making that
capability explicit.

## Compatibility

| Identifier   | Value                          | Stability                                   |
| ------------ | ------------------------------ | ------------------------------------------- |
| Product name | `TurboWarp-Sesame`             | Human-facing                                |
| Repository   | `kubohiroya/turbowarp-sesame`  | Current source                              |
| npm package  | `@kubohiroya/turbowarp-sesame` | Public package contract                     |
| Extension ID | `kubohiroyasesame`             | Stored in SB3; migration required to change |

## Development

Requires Node.js 22.12 or newer and the pnpm version declared in `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

See [`docs/architecture.md`](docs/architecture.md) for runtime and generated-artifact details.

## License

[Mozilla Public License 2.0](LICENSE) (SPDX: `MPL-2.0`).
