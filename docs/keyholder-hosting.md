# Hosting the keyholder

[日本語](keyholder-hosting.ja.md)

The keyholder holds the device secret for every lock paired with it. Its
isolation is not a property of the code: it is a property of the origin the
code is served from. This guide covers what that origin has to provide, the
ways to get one, and what living with it involves afterwards.

Background for the decisions here is in
[ADR 0001](adr/0001-ble-transport-and-key-custody.md).

## What actually has to be true

Two requirements, and they are independent. Hosts tend to satisfy both or
neither, which makes them easy to confuse.

### 1. The origin serves nothing else

This is a property of the _name_, not of the server. It asks nothing of the
software you run.

Browsers key these to the origin — scheme, host, and port:

| Isolated by origin                    | Keyed on                            |
| ------------------------------------- | ----------------------------------- |
| IndexedDB, where wrapped secrets live | origin                              |
| WebAuthn credentials                  | **host only — the port is ignored** |
| Camera permission                     | origin                              |
| Service worker scope                  | origin                              |

**Paths do not separate anything.** That is why
`kubohiroya.github.io/turbowarp-sesame/keyholder/` is not a boundary: every
other page published to that account shares its storage and its relying party.

**Ports do not separate enough.** A different port gives separate storage but
the _same_ WebAuthn relying party ID, because a relying party ID is a domain
and excludes the port. Two services on one host, split by port, would share
passkeys. A distinct hostname is the only thing that works.

### 2. The server can set response headers

This is a property of the _host_, not the name. You can have it on a shared
domain and lack it on a dedicated one.

Only one header genuinely has no alternative: `Content-Security-Policy:
frame-ancestors`, which is ignored when written in a `<meta>` tag. Without it,
any site on the web may embed the keyholder in an iframe. Framing alone does
not hand over keys — the channel needs the handshake, and unlocking needs the
authenticator — but a boundary you cannot state is a boundary you cannot audit.

Header control is what turns "nobody should embed this" into something the
browser enforces and you can verify with `curl`.

### What is not needed

- Anything dynamic: no API, no database, no server-side logic, no logging.
- **CORS.** The extension loads the keyholder as an iframe document and talks
  to it over `postMessage`. Nothing is fetched cross-origin, so
  `Access-Control-Allow-Origin` is not merely unnecessary, it is wrong here.
- Outbound network access of any kind. The page contacts no server.

The whole server-side requirement is: serve two static files over HTTPS with
correct content types, and set a few headers.

## Choosing where to host it

| Option                                                           | Serves nothing else | Can set headers | Cost                |
| ---------------------------------------------------------------- | ------------------- | --------------- | ------------------- |
| `kubohiroya.github.io/turbowarp-sesame/keyholder/` (the default) | ✗                   | ✗               | free                |
| A separate GitHub account or org → `<name>.github.io`            | ✅                  | ✗               | free                |
| Cloudflare Pages → `<project>.pages.dev`                         | ✅                  | ✅              | free                |
| Netlify → `<project>.netlify.app`                                | ✅                  | ✅              | free                |
| Your own domain on any static host                               | ✅                  | ✅              | domain registration |
| A web server you run                                             | ✅                  | ✅              | the server          |

Suggested reading of that table:

- **Trying the project out.** The default address is fine. Understand that it
  is not a boundary, and do not pair a key you would mind losing control of.
- **The simplest thing that satisfies both requirements.** Cloudflare Pages on
  its `*.pages.dev` name. Custom headers work there without a custom domain, so
  this costs nothing and requires no DNS work.
- **Something you intend to rely on.** A domain you register yourself, pointed
  at whichever static host you like. The reason is durability, discussed below.
- **A server you already run.** Entirely reasonable; see
  [Running it on your own server](#running-it-on-your-own-server).

### Why the name matters more than the hosting

Passkeys are bound to a relying party ID, which the browser derives from the
host. **Change the host and every stored key becomes unrecoverable**: the
wrapped secret is still in IndexedDB, but nothing can derive the key that
unwraps it. Everyone re-pairs from the sesame app.

So the name is a functional requirement, not branding. Losing it has the same
consequence whichever way you lose it:

- a domain registration lapses;
- a Cloudflare or Netlify account is closed and the project name is released;
- an institutional hostname goes away when you change institutions.

A name you register yourself is the only one of these you fully control. If you
host somewhere you do not own the name, a `CNAME` from a domain you do own
gives you the hosting convenience and keeps the name portable.

The code relies on the browser's default relying party ID: `createPasskey`
passes `rp: { name }` with no `id`, so the ID is the full hostname. **Never add
an `id` naming a parent domain** — that would let every subdomain of that
parent use the same credentials.

## Headers

The same policy in three formats. Use whichever your host takes.

`_headers`, for Cloudflare Pages and Netlify, at the site root:

```text
/
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  Permissions-Policy: camera=(self), bluetooth=(), geolocation=(), microphone=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Cross-Origin-Opener-Policy: same-origin

/index.html
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  Permissions-Policy: camera=(self), bluetooth=(), geolocation=(), microphone=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Cross-Origin-Opener-Policy: same-origin

/keyholder.js
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  Permissions-Policy: camera=(self), bluetooth=(), geolocation=(), microphone=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Cross-Origin-Opener-Policy: same-origin

/sw.js
  Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self'
  Permissions-Policy: camera=(self), bluetooth=(), geolocation=(), microphone=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Cross-Origin-Opener-Policy: same-origin
  Service-Worker-Allowed: /
```

Paths are listed one by one rather than as `/*` because **the service worker
needs a different policy from everything else**, and hosts differ in how they
combine two rules that both set the same header. Listing each path avoids
relying on that behaviour.

What each line is doing:

- **`default-src 'none'`** with no `connect-src` means the page cannot make a
  network request at all. The keyholder contacts no server by design; this
  turns that design claim into something a browser enforces.
- **`frame-ancestors 'none'`** because nothing embeds the keyholder. It is
  opened as a window of its own — Chrome partitions storage for a cross-site
  frame, so an embedded copy would read an empty store rather than the keys
  paired in it. Refusing to be framed at all is both correct and the strongest
  setting available.
- **`style-src 'unsafe-inline'`** is needed only because `index.html` carries a
  `<style>` block. Moving that CSS to a file and dropping `'unsafe-inline'` is
  a worthwhile tightening.
- **`camera=(self)`** allows the camera in the top-level page, where pairing
  happens. It cannot accidentally enable the camera in the embedded case: a
  cross-origin frame also needs the parent to grant `allow="camera"`, and
  TurboWarp does not.
- **`bluetooth=()`** states that the keyholder never touches Bluetooth. That is
  the TurboWarp page's job.
- **`connect-src 'self'` on `/sw.js` only.** The page itself must reach no
  network at all, but the service worker has to fetch the two files it caches.
  Giving it its own policy keeps that exception to the one script that needs
  it, rather than opening the page up.

Do not set `Cross-Origin-Embedder-Policy`: it is unnecessary here and breaks
embedding.

## Running it on your own server

The one prerequisite is a **hostname of its own**, as a name-based virtual
host. A path under an existing hostname is not a boundary, and a port is not
enough — see above. Getting the DNS record may be the only part that needs
someone else's cooperation.

### nginx

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name keyholder.example.org;

    ssl_certificate     /etc/letsencrypt/live/keyholder.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/keyholder.example.org/privkey.pem;

    root /var/www/sesame-keyholder;
    index index.html;
    autoindex off;

    add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" always;
    add_header Permissions-Policy "camera=(self), bluetooth=(), geolocation=(), microphone=()" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;

    location / { try_files $uri $uri/ =404; }

    # The service worker needs to fetch the files it caches, so it gets its own
    # policy. Every header is repeated here on purpose: an add_header in a
    # location block discards the ones inherited from the server block.
    location = /sw.js {
        add_header Content-Security-Policy "default-src 'none'; script-src 'self'; connect-src 'self'" always;
    add_header Permissions-Policy "camera=(self), bluetooth=(), geolocation=(), microphone=()" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Service-Worker-Allowed "/" always;
    }
}

server {
    listen 80;
    server_name keyholder.example.org;
    return 301 https://$host$request_uri;
}
```

**An `add_header` inside a `location` block discards every `add_header`
inherited from the server block.** That is why the `/sw.js` block above repeats
all of them; leave `location /` alone, and if you ever add a header there,
repeat the whole set. `always` is what sends the headers on error responses
too.

### Apache

Needs `a2enmod headers`.

```apache
<VirtualHost *:443>
    ServerName keyholder.example.org
    DocumentRoot /var/www/sesame-keyholder

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/keyholder.example.org/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/keyholder.example.org/privkey.pem

    Header always set Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    Header always set Permissions-Policy "camera=(self), bluetooth=(), geolocation=(), microphone=()"
    Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains"
    Header always set Referrer-Policy "no-referrer"
    Header always set X-Content-Type-Options "nosniff"
    Header always set Cross-Origin-Opener-Policy "same-origin"

    # The service worker needs to fetch the files it caches, so it gets its
    # own policy. `Header always set` replaces only the named header.
    <Files "sw.js">
        Header always set Content-Security-Policy "default-src 'none'; script-src 'self'; connect-src 'self'"
        Header always set Service-Worker-Allowed "/"
    </Files>

    <Directory /var/www/sesame-keyholder>
        Require all granted
        Options -Indexes -ExecCGI -Includes
        AllowOverride None
    </Directory>
</VirtualHost>
```

### Issuing the certificate and reloading

```bash
# nginx
sudo certbot certonly --nginx -d keyholder.example.org
sudo nginx -t && sudo systemctl reload nginx

# Apache
sudo certbot certonly --apache -d keyholder.example.org
sudo apachectl configtest && sudo systemctl reload apache2
```

Certbot installs its own renewal timer. Check that it is active with
`systemctl list-timers | grep certbot`, and verify renewal end to end once with
`sudo certbot renew --dry-run`. An expired certificate takes lock control down,
so this is worth doing rather than assuming.

### Three things to check before committing to a server you run

**Reachability.** The browser must reach the keyholder from wherever the lock
is used. A server reachable only from inside an institution's network cannot
serve a lock you want to open from home. Confirm this first; it is the failure
that wastes the most time.

**Availability becomes a precondition for opening the door.** A Bluetooth
session cannot start until the keyholder has loaded. Bluetooth itself never
touches the network, but the page does. Planned maintenance and reboots would
become outages of your lock control — which is what the service worker exists
to prevent. It ships as `sw.js` and registers itself on first visit; after that
the page loads from disk and the server being down stops mattering. Deploy it
alongside the other two files and give it the header rule above.

**Name continuity.** An institutional or employer hostname is not yours. If it
goes away, so do all the stored keys — and worse, if someone else later takes
over that hostname and serves a different site, their page runs on the same
origin as your stored secrets. When retiring such a host, make sure the name is
not simply handed on. A `CNAME` from a domain you own avoids the whole problem.

## Deploying

The keyholder is a built artifact of this repository.

```bash
pnpm run build
```

That produces `docs/keyholder/keyholder.js` from `src/keyholder/`. Publish
`docs/keyholder/index.html` and `docs/keyholder/keyholder.js` at the **root** of
the origin, so the page is `https://keyholder.example.org/` rather than a
subpath. A subpath works, but a short URL is easier to check before scanning a
key into it.

```bash
rsync -av --delete docs/keyholder/ user@server:/var/www/sesame-keyholder/
```

That copies three files: `index.html`, `keyholder.js`, and the service worker
`sw.js`. Put nothing else in that directory — that emptiness is the boundary.

The build is deterministic and both files are committed, so anyone can clone
this repository, run `pnpm run build`, and compare their output with what you
serve. That is a stronger integrity story than publishing a hash you also
control, and it needs no extra machinery.

## Pointing the project at your origin

Three places carry the URL. Change all three, then rebuild.

1. `src/block-definitions.json` — the `KEYHOLDER_URL` default value, which is
   what appears when someone drags the block out fresh.
2. `app/project.source.json` — the literal inside the standalone SB3.
3. `README.md` and `README.ja.md` — the documented address.

```bash
pnpm run build && pnpm run check
```

The default value is not part of the extension API manifest, so changing it
breaks no saved project. But **an existing `.sb3` keeps the URL it was saved
with**, so older copies of the standalone app keep talking to the old origin.
Either keep the old origin serving a page that says where to go, or accept that
old copies stop working.

## Verifying it

After the first deploy and after any header change:

```bash
# Headers are actually being sent.
curl -sI https://keyholder.example.org/ | grep -iE 'content-security-policy|permissions-policy|strict-transport'

# Both files are served, with content types the browser will accept.
curl -sI https://keyholder.example.org/ | grep -i content-type            # text/html
curl -sI https://keyholder.example.org/keyholder.js | grep -i content-type # text/javascript

# The service worker is served, and with the policy that lets it fetch.
curl -sI https://keyholder.example.org/sw.js | grep -iE 'content-type|content-security-policy'

# Plain HTTP redirects rather than serving anything.
curl -sI http://keyholder.example.org/ | head -1

# The directory does not list its contents.
curl -s https://keyholder.example.org/ | grep -qi '<title>Sesame keyholder' && echo 'page ok'
```

A `keyholder.js` served as `text/plain` or `application/octet-stream` will be
refused by the browser as a module, which shows up as a blank page rather than
an obvious error.

Then in a browser:

- Open the keyholder directly. It should pair a key and list it.
- Open the standalone SB3 in TurboWarp and connect. The iframe should load and
  a session should start.
- Keep DevTools' network panel open through a whole session. **There should be
  no requests after the initial load.** A blocked one appears as a CSP
  violation, which is the signal that something started phoning home.
- Put `<iframe src="https://keyholder.example.org/">` on any other page. It
  should be refused. If it renders, `frame-ancestors` is not being applied.
- In DevTools, check Application → Service Workers: one worker, activated, with
  a cache named `sesame-keyholder-<digest>` holding two entries. Then tick
  "Offline" and reload. **The page should still load.** If it does not, the
  worker did not install — usually the `/sw.js` header rule.

## Operating it

**Keeping the name is the largest ongoing risk**, whatever kind of name it is.
If someone else comes to control it, their page runs on the same origin as your
stored wrapped secrets and under the same relying party ID. They would still
need a user to approve with the authenticator, and that user would have no way
to tell they were being asked by a stranger. **Treat a lost name as a
compromised key**: delete the shared keys in the sesame app and pair new ones.

So: register for several years with auto-renew and a transfer lock, or, for a
name you do not own, know in advance what happens to it when you stop using it.
Put the expiry or review date somewhere a person will see it.

**Certificate expiry takes the app down.** The iframe fails to load and every
session fails with it. Renew automatically and monitor the certificate rather
than trusting that it renewed.

**Updating the keyholder** is a redeploy of three files. Stored keys survive:
they are in IndexedDB on that origin, and the origin has not changed. Rebuild
from this repository rather than editing deployed files, so the deployed copy
stays reproducible.

**Deploy `sw.js` together with the files it caches.** Its cache name is a digest
of those exact files, so a new build is a new worker: browsers fetch the new
script, install it, discard the previous cache, and take over. Nothing needs
bumping by hand and a stale keyholder cannot outlive a deploy. Deploying the
page without the worker, though, leaves visitors pinned to the cached old copy
until the worker changes — so never copy only some of the three.

A service worker is persistent code on the origin that holds your keys. It
cannot be installed by anyone who does not already control the origin, so it
adds no new way in; what it adds is persistence, which is worth knowing when
you think about what a compromise of this origin would mean. Unregistering it
is a matter of Application → Service Workers → Unregister, or serving a `sw.js`
that calls `self.registration.unregister()`.

## Recovery and revocation

**There is no backup and no export.** This is deliberate: an exportable key is a
key that can be exfiltrated. **The sesame app is the backup.** If a browser
profile is lost, cleared, or replaced, pair again by scanning a sharing QR code.

| Situation                                            | What to do                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Cleared site data, new computer, new browser profile | Pair again from the sesame app                                                                                     |
| Private window                                       | Keys never persist there; pair in a normal window                                                                  |
| Passkey removed from the authenticator               | The wrapped secret can no longer be unwrapped. Forget the device in the keyholder and pair again                   |
| Origin changed                                       | Everyone re-pairs. Passkeys do not move between origins                                                            |
| Origin suspected compromised                         | In the sesame app, delete the shared key that was paired, then share a new one. Forget the device in the keyholder |
| A shared device is lost                              | Delete that shared key in the sesame app                                                                           |

One caveat worth testing in your own setup: how quickly a lock stops honouring a
key deleted in the app is not something this project can verify from the
published documentation. Assume it is not instantaneous over Bluetooth, and do
not rely on deletion alone for an urgent revocation. Physically re-keying or
removing the device is the certain answer.

## What must never happen on this origin

- Serving any other application, page, or redirect.
- Adding analytics, tag managers, fonts, or any third-party script.
  `default-src 'none'` will block them, which is the point; do not relax it to
  make one work.
- Setting `rp.id` to a parent domain.
- Widening `frame-ancestors` to `*` or to a host you do not control.
- Serving over plain HTTP, even temporarily, even on a redirect path.

## Checklist

- [ ] A hostname of its own, serving nothing else
- [ ] The name is one you can keep, or one whose loss you have planned for
- [ ] HTTPS with automatic certificate renewal, certificate monitored
- [ ] Headers deployed and confirmed with `curl -I`
- [ ] `frame-ancestors` lists only the origins that embed the keyholder
- [ ] Embedding from an unlisted origin confirmed to fail
- [ ] No network requests after load, confirmed in DevTools
- [ ] Service worker installed, and the page still loads with DevTools offline
- [ ] Reachable from wherever the lock is actually used
- [ ] `KEYHOLDER_URL` updated in `src/block-definitions.json`, `app/project.source.json`, and both READMEs
- [ ] `pnpm run check` passes and the rebuilt artifacts are committed
- [ ] Old origin either redirects with an explanation or is knowingly retired
- [ ] Pairing and a full Bluetooth session tested end to end
