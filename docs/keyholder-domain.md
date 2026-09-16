# Running the keyholder on its own domain

[日本語](keyholder-domain.ja.md)

The keyholder holds the device secret for every lock paired with it. Its
isolation is not a property of the code: it is a property of the origin the
code is served from. This is the guide to choosing that origin, configuring it,
and living with it afterwards.

Background for the decisions here is in
[ADR 0001](adr/0001-ble-transport-and-key-custody.md).

## Why the default address is not good enough

`https://kubohiroya.github.io/turbowarp-sesame/keyholder/` works, and it is a
reasonable place to try the project. It is a weak boundary for two reasons.

**Every page on `kubohiroya.github.io` shares one origin.** Paths do not
separate storage. Any other project published to that account can read the
keyholder's IndexedDB and call `navigator.credentials.get()` under the same
relying party.

**GitHub Pages cannot send response headers.** In particular it cannot send
`Content-Security-Policy: frame-ancestors`, and that directive is ignored when
written in a `<meta>` tag. Any site on the web may therefore embed the
keyholder in an iframe. Framing alone does not hand over the keys — the channel
is only established by the handshake, and unlocking still needs the
authenticator — but a boundary you cannot state is a boundary you cannot audit.

Moving to a domain of your own fixes both.

## Choosing the domain

**A subdomain is enough.** An origin is scheme, host, and port, so
`keys.example.com` is fully separated from `www.example.com`. Registering a
second domain buys nothing that a dedicated subdomain does not already give.

**Nothing else may live on it.** Not a landing page, not a redirect, not
analytics, not a status page. The reason the origin is a boundary is that only
one thing is inside it.

**Choose once.** Passkeys are bound to a relying party ID, which the browser
derives from the origin's host. Change the host and every stored key becomes
unrecoverable: the wrapped secret is still there, but nothing can derive the
key that unwraps it. Moving domains means every user re-pairs from the sesame
app. Pick a name you are willing to keep renewing for as long as the locks are
in service.

The code relies on the browser's default relying party ID. `createPasskey`
passes `rp: { name }` with no `id`, so the ID is the full hostname. **Never add
an `id` that names a parent domain**: doing so would let every subdomain of
that parent use the same credentials, which is the isolation you just paid for.

## Choosing the host

| Requirement                    | Why                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| HTTPS with a valid certificate | WebAuthn and secure-context APIs demand it; an expired certificate takes the app down |
| Custom response headers        | `frame-ancestors` cannot be set any other way                                         |
| Static file serving only       | There is no server side; adding one adds attack surface                               |
| No shared origin               | See above                                                                             |

GitHub Pages meets the first and third but not the second. Hosts with a
`_headers` file — Cloudflare Pages, Netlify — meet all four, as does any static
host you configure yourself. The examples below use the `_headers` format.

## Headers

Place this at the site root as `_headers`:

```text
/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; frame-ancestors https://turbowarp.org; base-uri 'none'; form-action 'none'
  Permissions-Policy: camera=(self), bluetooth=(), geolocation=(), microphone=(), payment=(), usb=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Cross-Origin-Opener-Policy: same-origin
```

What each line is doing:

- **`default-src 'none'`** with no `connect-src` means the page cannot make a
  network request at all. The keyholder contacts no server by design, and this
  turns that claim into something a browser enforces and you can verify.
- **`frame-ancestors`** lists every page allowed to embed the keyholder. Add
  the origin of any self-hosted TurboWarp or packaged app you use; leave out
  everything else.
- **`style-src 'unsafe-inline'`** is needed only because `index.html` carries a
  `<style>` block. Moving that CSS into a file and dropping `'unsafe-inline'`
  is a worthwhile tightening.
- **`camera=(self)`** allows the camera in the top-level page, where pairing
  happens. It cannot accidentally enable the camera in the embedded case: a
  cross-origin frame also needs the parent to grant `allow="camera"`, and
  TurboWarp does not.
- **`bluetooth=()`** states that the keyholder never touches Bluetooth. That is
  the TurboWarp page's job, and the keyholder should fail loudly if it ever
  tries.
- **`Cross-Origin-Opener-Policy`** keeps the pairing window from sharing a
  browsing context group with whatever opened it.

Do not set `Cross-Origin-Embedder-Policy`: it is not needed here and breaks
embedding.

## Deploying

The keyholder is a built artifact in this repository.

```bash
pnpm run build
```

That produces `docs/keyholder/keyholder.js` from `src/keyholder/`. Publish
`docs/keyholder/index.html` and `docs/keyholder/keyholder.js` at the root of
the new origin, so the page is `https://keys.example.com/` rather than a
subpath. A subpath works, but the shorter the URL the easier it is for someone
to check they are on the right site before they scan a key into it.

The build is deterministic and both files are committed, so anyone can clone
the repository, run `pnpm run build`, and compare their output to what you
serve. That is a stronger integrity story than publishing a hash you also
control, and it needs no extra machinery.

## Pointing the project at the new origin

Three places carry the URL. Change all three, then rebuild.

1. `src/block-definitions.json` — the `KEYHOLDER_URL` default value, which is
   what appears when someone drags the block out fresh.
2. `app/project.source.json` — the literal inside the standalone SB3.
3. `README.md` and `README.ja.md` — the documented address.

```bash
pnpm run build && pnpm run check
```

The default value is not part of the extension API manifest, so changing it
does not break compatibility with saved projects. But **an existing `.sb3` keeps
the URL it was saved with.** Anyone still using an older copy of the standalone
app will keep talking to the old origin. Keep the old origin serving a page
that says where to go, or accept that old copies stop working.

## Verifying it

Run these after the first deploy and after any header change.

```bash
# Headers are actually being sent.
curl -sI https://keys.example.com/ | grep -iE 'content-security-policy|permissions-policy|strict-transport'
```

Then, in a browser:

- Open the keyholder directly. It should pair a key and list it.
- Open the standalone SB3 in TurboWarp and connect. The iframe should load and
  a session should start.
- With DevTools' network panel open, use the page for a whole session. **There
  should be no requests after the initial load.** A blocked request appears as
  a CSP violation, which is the signal that something new started phoning home.
- Put `<iframe src="https://keys.example.com/">` on any other page and load it.
  It should be refused. If it renders, `frame-ancestors` is not being applied.

## Operating it

**Domain renewal is the single largest risk.** If the registration lapses and
someone else takes the name, their page runs on the same origin as your stored
wrapped secrets and under the same relying party ID. They would still need a
user to approve with the authenticator, and the user would have no way to tell
they were being asked by a stranger. Treat a lost domain as a compromised key:
delete the shared keys in the sesame app and pair new ones.

Accordingly: register for several years, enable auto-renew, enable the
registrar's transfer lock, keep the registrar account on its own strong
credentials, and put the expiry date somewhere a human will see it.

**Certificate expiry takes the app down.** The iframe fails to load and every
session fails with it. Use a host that renews automatically, and monitor the
certificate rather than trusting that it renewed.

**Availability is an operational dependency.** A Bluetooth session needs the
keyholder to load first. Bluetooth itself never touches the network, but the
page does. Giving the keyholder its own service worker makes it load from cache
and removes the dependency for repeat use; that is worth doing on a domain you
intend to rely on.

**Updating the keyholder** is a redeploy of two files. Stored keys survive: the
wrapped secrets are in IndexedDB on that origin, and the origin has not
changed. Rebuild from this repository rather than editing the deployed files,
so the deployed copy stays reproducible.

## Recovery and revocation

**There is no backup and no export.** This is deliberate — an exportable key is
a key that can be exfiltrated. The sesame app is the backup: if a browser
profile is lost, cleared, or replaced, pair again by scanning a sharing QR
code.

The cases you should expect:

| Situation                                            | What to do                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Cleared site data, new computer, new browser profile | Pair again from the sesame app                                                                                     |
| Private window                                       | Keys never persist there; pair in a normal window                                                                  |
| Passkey removed from the authenticator               | The wrapped secret can no longer be unwrapped. Forget the device in the keyholder and pair again                   |
| Domain changed                                       | Everyone re-pairs. Passkeys do not move between origins                                                            |
| Keyholder origin suspected compromised               | In the sesame app, delete the shared key that was paired, then share a new one. Forget the device in the keyholder |
| A shared device is lost                              | Delete that shared key in the sesame app                                                                           |

One caveat worth testing in your own setup: how quickly a lock stops honouring
a key you deleted in the app is not something this project can verify from the
published documentation. Assume it is not instantaneous over Bluetooth, and do
not rely on deletion alone for an urgent revocation — physically re-keying or
removing the device is the certain answer.

## What must never happen on this origin

- Serving any other application, page, or redirect.
- Adding analytics, tag managers, fonts, or any third-party script. `default-src
'none'` will block them, which is the point; do not relax it to make one work.
- Setting `rp.id` to a parent domain.
- Widening `frame-ancestors` to `*` or to a host you do not control.
- Serving over plain HTTP, even temporarily, even on a redirect path.

## Checklist

- [ ] Dedicated domain or subdomain, serving nothing else
- [ ] Registered for multiple years, auto-renew on, transfer lock on, expiry monitored
- [ ] HTTPS with automatic certificate renewal, certificate monitored
- [ ] `_headers` deployed and confirmed with `curl -I`
- [ ] `frame-ancestors` lists only the origins that embed the keyholder
- [ ] Embedding from an unlisted origin confirmed to fail
- [ ] No network requests after load, confirmed in DevTools
- [ ] `KEYHOLDER_URL` updated in `src/block-definitions.json`, `app/project.source.json`, and both READMEs
- [ ] `pnpm run check` passes and the rebuilt artifacts are committed
- [ ] Old origin either redirects with an explanation or is knowingly retired
- [ ] Pairing and a full Bluetooth session tested end to end on the new origin
