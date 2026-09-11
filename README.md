# TurboWarp-Sesame

[English](README.md) | [日本語](README.ja.md)

A TurboWarp extension for inspecting Candy House Sesame devices and, in explicitly enabled builds,
requesting remote lock operations through the official Web API.

**User guide:** [English](https://kubohiroya.github.io/turbowarp-sesame/)

## What it does

- Reads lock state, battery level, angle, timestamp, and Wi-Fi module state.
- Retrieves recent Sesame history as JSON.
- Can request lock, unlock, and toggle operations in a build where the safety flag is enabled.
- Reports configuration and API failures through a block instead of stopping the project.

## Requirements and safety

- A Candy House API key, Sesame UUID, and 32-character hexadecimal secret key.
- A Sesame device reachable through the Candy House cloud, such as through WiFi Module 2.
- A browser with `fetch`, `TextEncoder`, and Web Crypto AES-CBC support.
- The extension is sandbox-compatible and should normally be loaded in the sandbox.

> [!CAUTION]
> Values typed directly into block inputs are stored in the `.sb3` project. Never publish or share a
> project containing real credentials. The extension keeps credentials only in runtime memory, but
> it cannot remove values written into saved blocks.

Remote lock commands are disabled in default builds. A command accepted by the cloud does not prove
that the physical lock moved; read the status again to confirm the result.

## Installation

1. Download [`dist/turbowarp-sesame.js`](dist/turbowarp-sesame.js?raw=1).
2. Open **Extensions** in TurboWarp.
3. Choose **Custom Extension** and load the file without enabling the unsandboxed option.

The reviewed JavaScript build is committed to this repository, so users do not need a build
environment.

For package consumers:

```bash
pnpm add --save-exact @kubohiroya/turbowarp-sesame@0.1.0
```

```text
node_modules/@kubohiroya/turbowarp-sesame/dist/turbowarp-sesame.js
```

## Quick start

1. Obtain credentials from the Candy House developer portal.
2. Run the configuration block once. Prefer reporter variables or a private local project over
   literal credentials in saved blocks.
3. Read a status field or history. Check `last Sesame error` after a failed operation.
4. Clear credentials before leaving the project running on a shared computer.

```text
configure API key (...) UUID (...) secret key (...)
say (Sesame status [CHSesame2Status])
clear Sesame credentials
```

## Block reference

This section is generated from [`src/block-definitions.json`](src/block-definitions.json).

<!-- BEGIN GENERATED BLOCKS -->

### `configure API key [API_KEY] UUID [UUID] secret key [SECRET_KEY]`

Keeps the Candy House credentials in memory until they are cleared or the extension reloads.

| Property     | Value                                                   |
| ------------ | ------------------------------------------------------- |
| Type         | Command                                                 |
| Opcode       | `configure`                                             |
| `API_KEY`    | String, default: `api-key`                              |
| `UUID`       | String, default: `00000000-0000-0000-0000-000000000000` |
| `SECRET_KEY` | String, default: `00000000000000000000000000000000`     |

### `clear Sesame credentials`

Removes all Candy House credentials held by the running extension.

| Property | Value              |
| -------- | ------------------ |
| Type     | Command            |
| Opcode   | `clearCredentials` |

### `Sesame credentials configured?`

Reports whether valid credentials are currently held in memory.

| Property | Value          |
| -------- | -------------- |
| Type     | Boolean        |
| Opcode   | `isConfigured` |

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
