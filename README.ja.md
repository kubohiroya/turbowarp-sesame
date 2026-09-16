# TurboWarp-Sesame

[English](README.md) | [日本語](README.ja.md)

Candy House Sesameの状態確認と、明示的に有効化したbuildでの遠隔施錠操作を行うTurboWarp機能拡張です。APIをブラウザから直接呼ぶDirect modeと、資格情報をlocalhostに分離するRelay modeを選べます。

**利用ガイド:** [English](https://kubohiroya.github.io/turbowarp-sesame/)

## できること

- 鍵の状態、電池残量、角度、更新時刻、Wi-Fiモジュール状態の取得
- Sesame履歴のJSON形式での取得
- 安全フラグを有効にしたbuildでの施錠、解錠、トグル要求
- 設定／APIエラーをプロジェクトを停止させずブロックから確認
- `@kubohiroya/keybroker`とのワンタイムコードによるローカルペアリング
- Bluetooth LEによる直接制御。クラウドもWiFi Module 2も不要
- 鍵が動いたことを機器が報告したときに動くハットブロック。これはBluetoothでしか得られません

## 動作条件と安全上の注意

- Bluetooth modeの推奨環境: desktopまたはAndroidのChromeかEdge、オーナー鍵またはマネージャー鍵の共有QRコード
- クラウド経由の推奨環境: localhostで起動した`@kubohiroya/keybroker`、デバイス別名、起動時のワンタイムコード
- Direct mode: Candy HouseのAPIキー、Sesame UUID、32文字の16進数秘密鍵
- WiFi Module 2などを通してCandy Houseクラウドから到達できるSesame
- `fetch`、`TextEncoder`、Web Crypto AES-CBCに対応するブラウザ
- Direct modeはsandboxで実行可能
- Relay modeはブラウザのlocalhostアクセス制約により「サンドボックスなしで実行」を有効にする必要がある

> [!CAUTION]
> Direct modeのブロックへ直接書いた値は`.sb3`プロジェクトに保存されます。実際の認証情報を含むプロジェクトを公開・共有しないでください。Relay modeではAPIキーとsecretをブロックへ渡しません。ペアリング後のRelay tokenは機能拡張の実行時メモリだけに保持します。

既定buildでは遠隔操作が無効です。また、クラウドがコマンドを受理しても物理的に鍵が動いた保証にはならないため、操作後に状態を再取得してください。

## インストール

1. [`dist/turbowarp-sesame.js`](dist/turbowarp-sesame.js?raw=1)をダウンロードします。
2. TurboWarpの**機能拡張**を開きます。
3. **カスタム機能拡張**からfileを選びます。Direct modeでは通常どおりsandbox内で読み込み、Relay modeでは「サンドボックスなしで実行」を有効にします。

## Relay mode（推奨）

1. [`@kubohiroya/keybroker`](https://github.com/kubohiroya/keybroker)をlocalhostで起動します。
2. カスタム機能拡張を「サンドボックスなしで実行」を有効にして読み込みます。ChromeなどはTurboWarpのsandbox iframeからlocalhostへの通信を許可しないためです。
3. `configure local Relay ...`でendpointとRelay設定内のデバイス別名を指定します。
4. Relayの標準出力に表示された8桁コードを`pair local Relay ...`へ入力します。
5. 状態または履歴を取得します。Relay再起動後は再度ペアリングします。

```text
configure local Relay [http://127.0.0.1:8787] device alias [front-door]
pair local Relay with one-time code (...)
say (Sesame status [CHSesame2Status])
clear Sesame connection
```

endpointとデバイス別名は秘密ではありません。8桁コードは5分以内に一度だけ利用でき、交換後に受け取るRelay tokenはブロックや`.sb3`へ保存されません。

## Bluetooth mode

機器と直接通信します。Candy Houseのクラウドも WiFi Module 2 も不要で、クラウドの受理応答ではなく実際の機械状態が得られます。

```text
configure Bluetooth keyholder [https://.../keyholder/] device alias [front-door]
pair Sesame by scanning its sharing QR code
connect to Sesame over Bluetooth
when the Sesame state changes
say (Sesame status [CHSesame2Status])
```

device secretはTurboWarpへ渡りません。keyholderページが自身のoriginで保持し、この機能拡張が機器へ書き込む前にすべてのフレームを封じます。[ADR 0001](docs/adr/0001-ble-transport-and-key-custody.ja.md)を参照してください。

注意:

- 「サンドボックスなしで実行」と、desktopまたはAndroidのChromeかEdgeが必要です。Safari、Firefox、iOSにはWeb Bluetoothがないため、Relay modeを使ってください。
- `connect to Sesame over Bluetooth`はクリック直後に実行してください。ブラウザのデバイス選択画面は直近のユーザー操作を要求します。
- **オーナー鍵かマネージャー鍵**をシェアしてください。ゲスト鍵はsecretの半分をサーバーが保持しているため、Bluetoothセッションを確立できません。
- Bluetoothにはページング付きの履歴がないため、履歴は取得できません。

## Direct mode

Candy House開発者ページから認証情報を取得し、`configure Direct mode ...`を実行します。これはRelayを起動できない場合の互換モードです。入力値が`.sb3`へ残る可能性があるため、実際の資格情報を含むプロジェクトを共有しないでください。

## ブロックリファレンス

| ブロック                          | 動作                                    |
| --------------------------------- | --------------------------------------- |
| `configure Direct mode ...`       | Direct資格情報を実行時メモリへ設定      |
| `configure local Relay ...`       | localhost Relayとデバイス別名を設定     |
| `pair local Relay ...`            | ワンタイムコードをメモリ内tokenへ交換   |
| `clear Sesame connection`         | Direct資格情報またはRelay sessionを消去 |
| `Sesame connection ready?`        | 現在の接続が利用可能か返す              |
| `local Relay paired?`             | Relay tokenを保持しているか返す         |
| `Sesame connection mode`          | `direct`、`relay`、未設定を返す         |
| `Sesame status [FIELD]`           | 現在の状態から指定fieldを取得           |
| `Sesame history page ...`         | 最大50件の履歴をJSON文字列で取得        |
| `Sesame [COMMAND] ...`            | flag有効buildで施錠・解錠・トグルを要求 |
| `Sesame remote commands enabled?` | 遠隔操作flagの状態を返す                |
| `last Sesame error`               | 直近の設定／通信エラーを返す            |

## 重要な動作

| 状況                         | 動作                                         |
| ---------------------------- | -------------------------------------------- |
| Direct認証情報が不正         | 以前の有効な設定を維持し、エラーを記録       |
| Relay endpointが外部host     | 設定を拒否し、localhost以外へtokenを送らない |
| Relay再起動／session期限切れ | 再ペアリングが必要                           |
| API／network失敗             | 空値または`[]`を返し、プロジェクトは継続     |
| 遠隔操作flagがOFF            | コマンドrequestを送信しない                  |
| コマンドが受理された         | 状態を再取得して実機動作を確認する必要がある |
| 接続消去／機能拡張再読込     | メモリ上の資格情報とRelay tokenを破棄        |

## 遠隔操作の有効化

遠隔操作は[`config/feature-flags.ts`](config/feature-flags.ts)で既定OFFです。物理的な鍵操作を意図するときだけ、sourceと安全上の影響を確認して`sesameCommands`を`true`へ変更し、ローカルbuildしてください。有効化したbuildを、その機能を明示せず配布しないでください。

## 互換性

| 識別子       | 値                             | 安定性                             |
| ------------ | ------------------------------ | ---------------------------------- |
| 製品名       | `TurboWarp-Sesame`             | 利用者向け表示                     |
| repository   | `kubohiroya/turbowarp-sesame`  | current source                     |
| npm package  | `@kubohiroya/turbowarp-sesame` | public package contract            |
| extension ID | `kubohiroyasesame`             | SB3に保存。変更にはmigrationが必要 |

## 開発

Node.js 22.12以上と`package.json`指定のpnpmを使用します。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

## ライセンス

[Mozilla Public License 2.0](LICENSE)（SPDX: `MPL-2.0`）で提供します。
