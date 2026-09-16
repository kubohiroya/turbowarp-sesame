# ADR 0001: BLE transportとブラウザ側の鍵保管

[English](0001-ble-transport-and-key-custody.md)

- **状態:** Proposed
- **日付:** 2026-09-16
- **置き換え対象:** なし
- **影響範囲:** `src/transport.ts`、`src/sesame-client.ts`、`src/relay-client.ts`、`src/extension.ts`、`@kubohiroya/keybroker`

## 背景

既存の2つのtransportはどちらもCandy Houseのクラウドで終端します。Direct modeはAPIキー、デバイスUUID、32文字の16進数secretを機能拡張instance上に保持し、blockへ直接書いた値は`.sb3`へ保存され得ます。Relay modeは資格情報をlocalhostのbrokerへ移すことでこの露出を解消しますが、別プロセスの常駐とsandboxなしでの読み込みを要求します。

CANDY HOUSEはSesameOS3のBluetooth LEプロトコル全体をMITライセンスで公開しています。この決定に関係する事実は次のとおりです。

- BLE service `0xFD81`、Tx characteristic `16860002-a5ae-9856-b6d3-dbb4c676993e`（write without response）、Rx characteristic `16860003-a5ae-9856-b6d3-dbb4c676993e`（notify）。
- 接続時に機器が4バイトの`random_code`をpublishします。セッショントークンは`AES_CMAC(device_secret, random_code)`です。以降のペイロードは13バイトのIV（`count(8) || 0x00 || random_code(4)`）と4バイトのtagによるAES-CCMです。
- コマンドは1バイトのitem codeです。`82`施錠、`83`解錠、`81`機器状態、`4`履歴。
- `mech_status`は物理状態が変化するたびに機器側から自発的にpush（`type = 0x08`）されます。

16バイトのBLE `device_secret`は、Web APIが既に要求している値と同一です。セサミアプリの鍵シェアQRコード（`ssm://UI?t=sk&sk=<base64>`）をデコードすると`0x05`に続く16バイトが現れ、これが現在`SesameClient`が`aesCmac`へ渡している値です。したがってBLE transportはユーザーへ新しい資格情報を要求しません。

BLE経路はクラウドの往復を除去し、WiFi Module 2なしで動作し、クラウドの受理応答ではなく実際の機械状態を報告し、攻撃者が同時に満たさねばならない条件として物理的なBluetooth近接性を追加します。同時に、HTTP transportが答える必要のなかった問いを生みます。ブラウザ自身が鍵を保持することになるためです。

## 決定

### 1. 3つ目の`SesameTransport`としての`BleTransport`

`src/transport.ts`に既に継ぎ目があります。`BleTransport`を`SesameClient`、`RelayClient`と並ぶ実装として追加します。明確化のため既存の2つを`CloudApiTransport`、`BrokerTransport`へ改名します。

BLEはHTTPにない能力と制約を持つため、契約を3点拡張します。

- `capabilities(): ReadonlySet<TransportCapability>` — `getHistory(page, length)`はBLEへ写像しません。BLEの履歴はitem code `4`を`is_peek`フラグ付きで叩いて1件ずつ引くpop型で、ページングの概念がないためです。呼び出し側が事前に問い合わせられる必要があります。
- 省略可能な`connect()` / `close()` — BLEは接続、notify有効化、`random_code`受信、loginという状態を持ちます。HTTP transportにはありません。
- 省略可能な`onStatusChange(listener)` — 自発的な`mech_status` publishを公開します。クラウドのtransportが提供できない能力であり、ハットブロックを可能にするためScratchの利用者にとって最も価値があります。

### 2. device_secretをJavaScriptヒープ上に生バイトとして置かない

BLEプロトコルは`device_secret`そのものを必要とせず、それを鍵とするAES演算だけを必要とします。

1. `AES_CMAC(device_secret, random_code)`は単一ブロックのAES暗号化に分解でき、これは非抽出可能な`AES-CBC`鍵で実行できます。`src/aes-cmac.ts`は既に`extractable: false`でimportしています。
2. 得られた16バイトのtokenを非抽出可能な鍵として再importし、AES-CCMに使います。Web CryptoにCCMモードがないため、AES-CTRとCBC-MACから組み立てます。

`CryptoKey`はstructured-clone可能なので、鍵objectをそのままIndexedDBへ保存します。ユーザーはペアリング時に一度だけ16進数のsecretを貼り付け、`extractable: false`でimportしたうえで文字列を破棄します。以降、そのレコードが存在する限り`exportKey()`はthrowします。

### 3. 保管の境界はTurboWarpのoriginではなくkeyholderのorigin

非抽出性は鍵の読み出しを防ぎますが、使用は防ぎません。同一origin上のスクリプトは保存された`CryptoKey`で`subtle.encrypt`を呼び、ドアを開けられます。そのoriginは`https://turbowarp.org`であり、ユーザーが今後読み込むあらゆるカスタム機能拡張とプロジェクトに共有されます。brokerの境界より弱い状態です。

したがって鍵は、プロジェクトが管理するoriginから配信されるクロスオリジンiframe（keyholder）に置きます。TurboWarpのページはこのoriginのIndexedDBを読めません。

```text
TurboWarpページ (turbowarp.org)        keyholder iframe (プロジェクトのorigin)
  BleTransport                           IndexedDB内のCryptoKey
    | postMessage: "lock, tag=..."  ->   AES-CMAC、AES-CCM、セグメント分割
    | <- 暗号化済みBLEフレーム
  Txへのgatt write  ------------------------------------> Sesame
  Rxからのnotify
    | postMessage: 生バイト列       ->   復号、解析
    | <- { itemCode, payload }
```

Web Bluetoothは親側に残します。`bluetooth` Permissions Policyの既定allowlistは`self`であり、TurboWarpはframeへ`allow="bluetooth"`を付与しないためです。親は鍵も平文も見ないバイトパイプになるため、これは許容できます。

これはlocalhostの代わりにoriginを分離境界に据えたbrokerアーキテクチャです。資格情報がクライアントへ届かないという同じ不変条件と、信頼できる構成要素側でポリシーを強制する能力（解錠前の確認、レート制限、施錠専用モード）を保ちながら、常駐プロセスのインストールを不要にします。

### 4. 使用をユーザー検証で制御する

keyholderはsecretをそのまま使える形ではなく、ラップして保存します。WebAuthnのPRF拡張（`extensions.prf`を指定した`navigator.credentials.get`）から鍵暗号化鍵を導出し、HKDFを通し、`unwrapKey`でメモリ上だけの非抽出可能な`CryptoKey`へ復元します。これにより各セッションでプラットフォーム認証器の操作が必要になり、公式アプリの生体認証プロンプトと同じ体験になります。保存されたblob単体は無価値です。PRFはChrome/Edge、macOS 15以降のSafari 18以降、Firefox 147以降で利用できます。利用できない環境ではPBKDF2によるパスフレーズラップへフォールバックします。

### 5. `@kubohiroya/capability-proxy`を`@kubohiroya/keybroker`へ改名する

「クライアントへprovider資格情報を渡さずに名前付きcapabilityを公開するlocalhost優先のrelay」は、標準的な用語ではcredential brokerです。旧名は何を仲介するのかについて情報を持ちませんでした。改名後もクラウドWeb API経路としての役割は維持します。遠隔操作、Web Bluetooth非対応ブラウザ、Bluetooth圏外からの制御には引き続き必要だからです。

### 6. ペアリングはアプリの共有QRコードを、keyholderの最上位ウィンドウで読み取る

セサミアプリは`ssm://UI`のURLを収めたQRコードとして鍵を共有します。その`sk`形式はサーバーを必要とせず自己完結しています。

```text
ssm://UI?t=sk&sk=<base64>&l=<鍵レベル>&n=<デバイス名>
```

base64の値はパックされたレコードへデコードされます。その構造は先頭バイトの機種によって変わります。SESAME 5以降は4バイトの公開鍵を、それ以前の機種は64バイトの公開鍵を持つためです。

```text
機種 >= 5   [0] 機種 | [1..16] secret | [17..20] 公開鍵 | [21..22] key index | [23..38] UUID
機種 <  5   [0] 機種 | [1..16] secret | [17..80] 公開鍵 | [81..82] key index | [83..98] UUID
```

この16バイトのsecretが決定2の`device_secret`であり、UUIDはWeb APIが使うデバイスUUIDと同じものです。したがってスキャンは手動の資格情報入力を丸ごと置き換えます。16進数を書き写す必要も、UUIDを貼り付ける必要もなく、機種に応じた正しい公開鍵も同時に得られます。

**スキャンはkeyholder originの最上位ウィンドウで行い、iframeでもTurboWarpのページでも行いません。** QRはsecretを平文で運ぶため、それをデコードしたページはsecretを保持することになります。TurboWarpのページにデコードさせれば決定3が無効になります。iframeでも実行できません。`camera` Permissions Policyの既定allowlistは`bluetooth`と同じく`self`であり、TurboWarpは`allow="camera"`を付与しないためです。keyholder originの最上位browsing contextはそれ自身が`self`なので、そこではカメラが使えます。ペアリングはそのウィンドウを開き、スキャンし、secretを非抽出可能な`CryptoKey`としてimportし、ラップして閉じます。機能拡張が知るのはデバイス名とペアリングが成功したことだけです。以降のセッションはカメラを必要としないiframeを通ります。

デコードはプラットフォームが提供する`BarcodeDetector`を使います（macOS、Android、ChromeOS）。WindowsとLinuxのChromeにはプラットフォーム側のバーコード対応がありませんが、それを補うサードパーティのデコーダはバンドルしません。このページはドアの鍵を保持しており、その傍らで動くコードは少ないほど良いからです。該当環境では、各自のQRリーダーが出力したテキストを貼り付けてもらいます。体験は劣りますが、結果は劣りません。いずれの場合も映像フレームはkeyholderの外へ出ません。

keyholderの隔離はoriginの強さを超えません。`*.github.io`のような共有ホストから配信する場合、そのホスト上の他のあらゆるページがoriginを共有し、したがって保存された鍵も共有します。本番のkeyholderには専用ドメインが適切です。GitHub Pagesのアドレスは使える既定値ではありますが、強い境界ではありません。

### 7. QRコードの鍵レベルは参考情報であり、ポリシーは別に保存する

アプリはオーナー、マネージャー、ゲストの3種類のQRコードを提供します。レベルはペイロードの内側ではなく、`l`クエリパラメータ（`0`、`1`、`2`）として並んで運ばれます。暗号化も認証もされておらず、Bluetoothプロトコルにはレベルという概念自体がありません。item code `82`と`83`は有効なセッションを持つ相手からであれば受理されます。

ゲスト鍵を分けているのはラベルではなくペイロードであり、その差は決定的です。**ゲスト鍵はsecretの先頭8バイトがゼロで埋められています。** 公開されているSDKはまさにこのパターンを検出し、一致した場合はオフライン動作を拒否します。`AES_CMAC(device_secret, randomCode)`を自分で計算せず、ネットワークを待ってサーバーにセッショントークンの署名を依頼します。その8バイトはQRコードに最初から入っていません。したがってゲスト鍵ではBluetoothセッションを確立できず、このプロジェクトはloginで失敗させるのではなく、解析時点で理由を添えて拒否します。

オーナー鍵とマネージャー鍵はsecret全体を運び、オフラインで動作します。両者ではマネージャー鍵を推奨します。オーナーがアプリから削除できる別個の鍵であるのに対し、オーナー鍵は他のすべてが依存している鍵だからです。

ここから導かれる帰結は明示しておく価値があります。Bluetooth制御には完全な強度の資格情報が必要であり、弱い資格情報を渡すという選択肢は存在しません。鍵をkeyholder originに閉じ込めてユーザー検証で保護する理由も、ポリシーを`l`から推論せず鍵と並べて保存する理由も、まさにこれです。

したがってkeyholderは`l`を「どの種類の鍵を読み取ったか」の表示のために記録し、権限として扱ってはなりません。このプロジェクトが強制する制限（解錠前の確認、施錠専用モード、レート制限）は、鍵と並べてkeyholderが保存するポリシーに属し、レベルによらずすべての鍵へ適用します。

アプリは有効期限の短い暗号化された共有コードを提示することもあります。公開されているSDKは`sk`のほかに2つのQR種別（`friend`と`matter`）と`invite`パラメータを定義していますが、期限付きコードの符号化は定義していないため、このプロジェクトはその読み取りを試みません。期限切れが起きるコードには、それがまだ有効かを判断するサーバーが必然的に存在します。それはBluetooth経路が取り除こうとしている依存そのものです。期限付きコードしか得られない場合の答えは、代わりに`sk`コードを書き出すか、brokerを使うことです。

## 結果

### 得るもの

- どのmodeでも`.sb3`へ資格情報が書き込まれない。
- Candy Houseのクラウドなし、WiFi Module 2なし、常駐プロセスのインストールなしでの動作。
- クラウドの受理応答に代えて`mech_status` pushによる実際の機械状態。受理応答は鍵が物理的に動いたことを証明しない。
- 攻撃者が同時に満たさねばならない条件としての物理的なBluetooth近接性。
- クラウド往復より低いレイテンシ。
- アプリの共有QRコードのスキャンによるペアリング。16進数のsecretとデバイスUUIDを手で書き写す作業を置き換え、書き写し間違いが起こり得なくなる。

### 手放すもの、新たに必要になるもの

- **対応ブラウザが狭まる。** Web BluetoothはdesktopとAndroidのChrome、Edge、Chromium派生にしか存在しません。Safari、Firefox、iOS全般は対象外です。これらの利用者にはbroker経路が引き続き答えになります。
- **BLE経路ではsandbox実行ができない。** sandboxされた機能拡張はopaque originで動作し、IndexedDBが使えずWeb Bluetoothも遮断されます。Direct modeが持っていたsandbox互換性という利点を、資格情報をプロジェクトファイルから排除することと引き換えにします。後者の方が大きな利得です。
- **AES-CCMを自前で実装する必要がある。** 既存の`src/aes-cmac.ts`と同じ書き方で、AES-CTRとCBC-MACの上に約100行。
- **`requestDevice()`はtransient user activationを要求する。** 最初のコマンド時に暗黙に接続するのではなく、クリック直後に実行する明示的な接続ブロックが必要です。
- **鍵は単一のブラウザプロファイルに閉じる。** 閲覧データの消去で失われ、プライベートウィンドウでは保持されず、デバイス間で同期されません。再ペアリングの導線が必要であり、keyholderは不透明に失敗せず明確に劣化しなければなりません。
- **同一originからの使用は原理的に残る。** iframeのoriginとPRFによる制御は窓を狭めますが、閉じはしません。認証済みセッション中にkeyholderのoriginが侵害されれば、依然として鍵を操作できます。
- **WindowsとLinuxではバーコードデコーダのバンドルが必要。** これらのChromeには`BarcodeDetector`の背後にあるプラットフォーム側のバーコード対応がない。
- **ゲスト鍵は利用できない。** secretの半分がゼロで残りはサーバーが保持するため、Bluetooth制御にはオーナー鍵かマネージャー鍵が必要になる。完全な強度の資格情報であり、弱いものを渡すという選択肢はない。
- **期限付き共有コードには対応しない。** 自己完結する`sk`形式のみを対象とする。期限付きコードの符号化は公開SDKになく、引き換えにはサーバーが必要になるため。
- **非抽出性はハードウェア保護ではない。** 鍵素材はブラウザプロファイル内のディスク上にあり、ファイル権限と全ディスク暗号化だけに守られます。ロック解除済みのマシンを取得した攻撃者は勝ちます。これはbrokerの設定ファイルや、公式アプリの入ったスマートフォンでも同じです。

## 検討した代替案

**`turbowarp.org`のIndexedDBへ直接鍵を置く。** 却下。実装は最も単純ですが、originがユーザーの読み込むあらゆる機能拡張とプロジェクトに共有されるため、非抽出可能な鍵であっても無関係なコードから操作され得ます。

**Web Bluetooth自体をkeyholder iframe内で動かす。** 不可能として却下。`bluetooth` Permissions Policyは既定で`self`であり、最上位documentが`allow="bluetooth"`を付与する必要がありますが、TurboWarpはこれを行いません。

**BLEをbroker側へネイティブスタックで追加する。** 実現可能です。Nodeの`@abandonware/noble`またはPythonの`bleak`を使い、AES-CCMはNodeの`crypto`に`aes-128-ccm`として存在するため自前実装が不要になります。ただし、BLE経路が取り除こうとしている常駐プロセスのインストールを復活させるため、主経路としては却下します。headless環境および非Chromium環境向けの将来の選択肢として保持します。

**BLEの登録フローを実装する。** 範囲外として却下。登録には新しい`device_secret`を導出するsecp256r1のECDH鍵交換が必要です。既存の鍵シェアQRのsecretをlogin経路で再利用すればこれを完全に回避でき、`libsesame3bt`が`set_keys("", SECRET)`で動作するのと同じ方式になります。

## 参照

- [CANDY-HOUSE Sesame Bluetooth API document](https://github.com/CANDY-HOUSE/Sesame_BluetoothAPI_document)（MIT）
- [SesameOS3/bluetooth.ja.md](https://github.com/CANDY-HOUSE/API_document/blob/master/SesameOS3/bluetooth.ja.md)
- [libsesame3bt-core](https://github.com/homy-newfs8/libsesame3bt-core)
- [Permissions-Policy: bluetooth](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/bluetooth)
- [WebAuthn PRF extension](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions)
- [SesameSDK iOS `URL+Sesame2.swift`](https://github.com/CANDY-HOUSE/SesameSDK_iOS_with_DemoApp/blob/master/SesameUI/Shared/Extensions/URL%2BSesame2.swift) — 共有QRの符号化
- [SesameSDK iOS `KeyLevel.swift`](https://github.com/CANDY-HOUSE/SesameSDK_iOS_with_DemoApp/blob/master/SesameUI/Shared/Util/KeyLevel.swift) — オーナー、マネージャー、ゲスト
- [Permissions-Policy: camera](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/camera)
- [Barcode Detection API](https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API)
- [NIST SP 800-38C](https://csrc.nist.gov/pubs/sp/800/38/c/upd1/final) と [RFC 3610](https://www.rfc-editor.org/rfc/rfc3610) — AES-CCM
