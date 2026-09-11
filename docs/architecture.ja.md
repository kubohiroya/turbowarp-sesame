# アーキテクチャ

[English](architecture.md)

## 実行時の境界

機能拡張はTurboWarpのsandbox内で動作し、Direct modeまたはRelay modeを選択します。`SesameExtension`がblock値の変換、接続状態、error捕捉を担当し、両modeは`SesameTransport`契約を実装します。

```text
Direct: TurboWarp -> SesameClient -> Candy House API
Relay:  TurboWarp -> RelayClient -> 127.0.0.1 Capability Proxy -> Candy House API
```

Direct modeでは認証情報を機能拡張instance上だけに保持します。Relay modeではAPIキー、UUID、secretをTurboWarpへ渡さず、endpoint、デバイス別名、ペアリング後のtokenだけを保持します。tokenはstorageへ保存せず、機能拡張の再読込で失効します。`RelayClient`はHTTPのloopback originだけを許可し、外部hostへtokenを送信しません。

遠隔操作は`config/feature-flags.ts`のbuild時定数で制御します。この確認をclient生成、署名、HTTP accessより前に行うため、OFFのbuildはcommand requestを送信できません。

## ビルド出力

このプロジェクトは実行時の動作と互換性メタデータを分離し、リポジトリに保存された同じソース定義から両方を生成します。

```text
src/index.ts + src/extension.ts + transports and clients
  -> vite-plugin-turbowarp-extension
  -> dist/<extension>.js

src/config.ts + src/block-definitions.json
  -> extension-api-manifest Viteプラグイン
  -> dist/extension-manifest.json
```

manifestプラグインはViteのビルド後フェーズで実行されます。これにより、JavaScriptプラグインの単一出力検証を維持しながら、TurboWarpバンドルの完成後にだけmanifestを追加します。

## 拡張機能API manifest v1

`schemas/extension-manifest.schema.json`が規範となるJSON Schemaです。`formatVersion`は`1`で、互換性のないmanifest形式を導入するときに変更する必要があります。

v1契約は次の情報を含みます。

- TurboWarp拡張機能のID
- 各ブロックのopcodeとブロック種類
- 各引数のID、引数種類、任意のメニュー参照
- 各メニューのIDとReporterブロックを受け付けるかどうか

ブロック、引数、メニューは、シリアライズ前に識別子で並べ替えられます。テキスト、説明、既定値、静的メニュー項目は、保存済みプロジェクトのAPI参照を識別しないため、意図的に除外しています。そのため互換性チェッカーは、API変更とドキュメントまたはローカライズの変更を区別できます。

## 差分の検出

`dist/`はリリース成果物としてコミットされます。`pnpm run check:dist`は両方のファイルを再ビルドし、`dist/`配下に変更、削除、未追跡ファイルがある場合に失敗します。これにより、ローカル検証とCIの両方でmanifestとバンドルの差分を検出できます。
