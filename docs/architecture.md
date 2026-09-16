# Architecture

[日本語](architecture.ja.md)

## Runtime boundary

Direct mode runs in TurboWarp's sandbox. For Relay mode, the same extension must be loaded with
**Run extension without sandbox** enabled because of browser Local Network Access restrictions.
`SesameExtension` owns block conversion, connection state, and error capture. It also rejects Relay
configuration inside the sandbox before contacting localhost. Both modes implement the
`SesameTransport` contract.

```text
Direct: TurboWarp -> SesameClient -> Candy House API
Relay:  TurboWarp -> RelayClient -> 127.0.0.1 keybroker -> Candy House API
```

Direct credentials live only on the extension instance. Relay mode never receives the provider API
key, UUID, or secret. It stores only the endpoint, device alias, and paired token. The token is not
written to storage and disappears when the extension reloads. `RelayClient` accepts only HTTP
loopback origins, preventing token delivery to a remote host.

Remote commands are gated by the build-time constant in `config/feature-flags.ts`. The check occurs
before client creation, signing, or HTTP access, so an OFF build cannot send a command request.

## Build outputs

The project keeps runtime behavior and compatibility metadata separate while generating both from
the same checked-in source definitions.

```text
src/index.ts + src/extension.ts + transports and clients
  -> vite-plugin-turbowarp-extension
  -> dist/<extension>.js

src/config.ts + src/block-definitions.json
  -> extension-api-manifest Vite plugin
  -> dist/extension-manifest.json
```

The manifest plugin runs in Vite's post-build phase. This preserves the JavaScript plugin's
single-output validation and adds the manifest only after the TurboWarp bundle is complete.

## Extension API manifest v1

`schemas/extension-manifest.schema.json` is the normative JSON Schema. `formatVersion` is `1` and
must change when an incompatible manifest shape is introduced.

The v1 contract contains:

- the TurboWarp extension ID;
- each block opcode and block type;
- each argument ID, argument type, and optional menu reference;
- each menu ID and whether it accepts reporter blocks.

Blocks, arguments, and menus are sorted by their identifiers before serialization. Text,
descriptions, default values, and static menu items are intentionally excluded because they do not
identify saved-project API references. A compatibility checker can therefore distinguish API
changes from documentation or localization changes.

## Drift detection

`dist/` is committed as a release artifact. `pnpm run check:dist` rebuilds both files and fails when
Git reports any modified, deleted, or untracked file below `dist/`. This catches manifest and bundle
drift in local checks and CI.

## Decision records

- [ADR 0001: BLE transport and browser-side key custody](adr/0001-ble-transport-and-key-custody.md) — Proposed
