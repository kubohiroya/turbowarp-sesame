# TurboWarp-Sesame

[English](README.md) | [日本語](README.ja.md)

Candy House Sesameの状態確認と、明示的に有効化したbuildでの遠隔施錠操作を、公式Web API経由で行うTurboWarp機能拡張です。

**利用ガイド:** [English](https://kubohiroya.github.io/turbowarp-sesame/)

## できること

- 鍵の状態、電池残量、角度、更新時刻、Wi-Fiモジュール状態の取得
- Sesame履歴のJSON形式での取得
- 安全フラグを有効にしたbuildでの施錠、解錠、トグル要求
- 設定／APIエラーをプロジェクトを停止させずブロックから確認

## 動作条件と安全上の注意

- Candy HouseのAPIキー、Sesame UUID、32文字の16進数秘密鍵
- WiFi Module 2などを通してCandy Houseクラウドから到達できるSesame
- `fetch`、`TextEncoder`、Web Crypto AES-CBCに対応するブラウザ
- sandbox対応のため、通常は「サンドボックスなし」を選択しないで読み込む

> [!CAUTION]
> ブロックの入力欄へ直接書いた値は`.sb3`プロジェクトに保存されます。実際の認証情報を含むプロジェクトを公開・共有しないでください。機能拡張自身は認証情報を実行時メモリだけに保持しますが、保存済みブロックの値は除去できません。

既定buildでは遠隔操作が無効です。また、クラウドがコマンドを受理しても物理的に鍵が動いた保証にはならないため、操作後に状態を再取得してください。

## インストール

1. [`dist/turbowarp-sesame.js`](dist/turbowarp-sesame.js?raw=1)をダウンロードします。
2. TurboWarpの**機能拡張**を開きます。
3. **カスタム機能拡張**からfileを選び、「サンドボックスなし」を有効にせず読み込みます。

## クイックスタート

1. Candy House開発者ページから認証情報を取得します。
2. 設定ブロックを一度実行します。保存済みブロックへ認証情報を直接書く代わりに、非公開のローカルプロジェクトや変数の利用を推奨します。
3. 状態または履歴を取得します。失敗時は`last Sesame error`を確認します。
4. 共有PCでは作業終了前に認証情報消去ブロックを実行します。

```text
configure API key (...) UUID (...) secret key (...)
say (Sesame status [CHSesame2Status])
clear Sesame credentials
```

## ブロックリファレンス

| ブロック                          | 動作                                    |
| --------------------------------- | --------------------------------------- |
| `configure API key ...`           | 検証済み認証情報を実行時メモリへ設定    |
| `clear Sesame credentials`        | 実行時メモリの認証情報を消去            |
| `Sesame credentials configured?`  | 認証情報が設定済みか返す                |
| `Sesame status [FIELD]`           | 現在の状態から指定fieldを取得           |
| `Sesame history page ...`         | 最大50件の履歴をJSON文字列で取得        |
| `Sesame [COMMAND] ...`            | flag有効buildで施錠・解錠・トグルを要求 |
| `Sesame remote commands enabled?` | 遠隔操作flagの状態を返す                |
| `last Sesame error`               | 直近の設定／通信エラーを返す            |

## 重要な動作

| 状況                         | 動作                                         |
| ---------------------------- | -------------------------------------------- |
| 認証情報が不正               | 以前の有効な設定を維持し、エラーを記録       |
| API／network失敗             | 空値または`[]`を返し、プロジェクトは継続     |
| 遠隔操作flagがOFF            | コマンドrequestを送信しない                  |
| コマンドが受理された         | 状態を再取得して実機動作を確認する必要がある |
| 認証情報消去／機能拡張再読込 | メモリ上の認証情報を破棄                     |

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
