# docs/

GitHub Pages serves this directory.

- [`index.html`](index.html) — the usage guide, published at the site root
- [`keyholder/`](keyholder/) — the keyholder page, published at `/keyholder/`
- [`architecture.md`](architecture.md) ([日本語](architecture.ja.md))
- [`keyholder-hosting.md`](keyholder-hosting.md) ([日本語](keyholder-hosting.ja.md))
- [`device-testing.md`](device-testing.md) ([日本語](device-testing.ja.md))
- `turbowarp-sesame-app.sb3` — the standalone app, published for download
- [`adr/`](adr/) — decision records

`.github/workflows/pages.yml` uploads this directory as the Pages artifact, so
every file is served exactly as committed. `.nojekyll` keeps that true if the
site is ever switched back to building from a branch, where Jekyll would
otherwise process it.

Serving the bytes unchanged matters for `keyholder/`: the integrity claim in
[keyholder-hosting.md](keyholder-hosting.md) is that anyone can rebuild this
repository and compare their output with what is served, and a build step
between the two would break it.

`keyholder/keyholder.js`, `keyholder/sw.js`, and `turbowarp-sesame-app.sb3` are
build outputs. Run `pnpm run build`; do not edit them here.
