# keyholderのホスティング

[English](keyholder-hosting.md)

keyholderは、そこでペアリングしたすべての鍵のdevice secretを保持します。その隔離はコードの性質ではなく、コードが配信される**originの性質**です。この文書は、そのoriginが満たすべき条件、その入手方法の選択肢、そしてその後の運用を扱います。

判断の背景は[ADR 0001](adr/0001-ble-transport-and-key-custody.ja.md)にあります。

## 満たすべき条件は2つ

そしてこの2つは**独立**しています。ホスティングは両方を満たすか両方満たさないかのどちらかになりがちなので、混同されやすいところです。

### 1. そのoriginに他に何も無いこと

これは**名前の性質**であって、サーバーの性質ではありません。動かすソフトウェアに何も要求しません。

ブラウザがorigin（scheme + host + port）をキーに分離しているもの:

| originで分離されるもの                | キー                           |
| ------------------------------------- | ------------------------------ |
| IndexedDB（ラップ済みsecretの置き場） | origin                         |
| WebAuthnの認証情報                    | **hostのみ。portは無視される** |
| カメラの許可                          | origin                         |
| Service Workerのスコープ              | origin                         |

**パスは何も分離しません。** だから`kubohiroya.github.io/turbowarp-sesame/keyholder/`は境界になりません。同じアカウントで公開された他のページが、ストレージもrelying partyも共有します。

**ポートでは分離しきれません。** ポートを変えればストレージは分かれますが、WebAuthnのrelying party IDは**同じ**です。relying party IDはドメインであり、portを含まないからです。1つのhostをポートで分けた2つのサービスは、パスキーを共有します。**独立したホスト名だけが機能します。**

### 2. サーバーがレスポンスヘッダーを設定できること

これは**ホスティングの性質**であって、名前の性質ではありません。共有ドメインで持てることもあれば、専用ドメインで持てないこともあります。

代替手段が本当に無いヘッダーは1つだけです。`Content-Security-Policy: frame-ancestors` で、これは`<meta>`タグに書いても無視されます。これが無ければ、**ウェブ上のどのサイトでもkeyholderをiframeに埋め込めます。** 埋め込めるだけで鍵が渡るわけではありません（通信路にはハンドシェイクが要り、解錠には認証器が要ります）が、宣言できない境界は監査できない境界です。

ヘッダー制御が買っているのは、「誰も埋め込まないはず」という期待を、**ブラウザが強制し`curl`で検証できる事実**に変えることです。

### 不要なもの

- 動的処理の一切。API、データベース、サーバーサイドロジック、ログ
- **CORS。** 機能拡張はkeyholderを**iframeのドキュメントとして**読み込み、`postMessage`で話します。cross-originのfetchをしないので、`Access-Control-Allow-Origin`は不要というより**ここでは誤り**です
- あらゆる外向き通信。このページはサーバーへ接続しません

サーバー側の要求はこれだけです: **静的ファイル2つを正しいContent-TypeでHTTPS配信し、ヘッダーをいくつか設定する。**

## ホスティングの選択肢

| 選択肢                                                     | 他に何も無い | ヘッダー設定可 | 費用       |
| ---------------------------------------------------------- | ------------ | -------------- | ---------- |
| `kubohiroya.github.io/turbowarp-sesame/keyholder/`（既定） | ✗            | ✗              | 無料       |
| GitHubの別アカウント/org → `<name>.github.io`              | ✅           | ✗              | 無料       |
| Cloudflare Pages → `<project>.pages.dev`                   | ✅           | ✅             | 無料       |
| Netlify → `<project>.netlify.app`                          | ✅           | ✅             | 無料       |
| 自分のドメイン + 任意の静的ホスト                          | ✅           | ✅             | ドメイン代 |
| 自分で運用するWebサーバー                                  | ✅           | ✅             | サーバー   |

読み方の目安:

- **試してみる段階。** 既定のアドレスで構いません。ただし境界ではないことを理解し、**失っても困らない鍵以外はペアリングしない**でください
- **両方の条件を満たす最も簡単な方法。** Cloudflare Pagesの`*.pages.dev`。カスタムドメイン無しでもカスタムヘッダーが効くので、費用もDNS作業もかかりません
- **本当に頼りにするなら。** 自分で登録したドメインを、好きな静的ホストへ向ける。理由は後述の耐久性です
- **既に運用しているサーバーがあるなら。** まったく妥当です。[自前のサーバーで運用する](#自前のサーバーで運用する)を参照してください

### ホスティングより名前のほうが重要な理由

パスキーはrelying party IDに束縛され、ブラウザはそれをhostから導出します。**hostを変えれば保存済みの鍵はすべて復元不能になります。** ラップされたsecretはIndexedDBに残りますが、それを解く鍵をもう何も導出できません。全員がセサミアプリから再ペアリングすることになります。

つまり名前はブランディングではなく**機能要件**です。失い方によらず結果は同じです。

- ドメインの登録が失効する
- CloudflareやNetlifyのアカウントを閉じ、プロジェクト名が解放される
- 所属が変わり、組織のホスト名が無くなる

このうち完全に自分で制御できるのは、自分で登録した名前だけです。名前を所有していない場所でホストする場合は、**自分が持つドメインから`CNAME`を向けておけば**、ホスティングの手軽さを得ながら名前を持ち運べます。

コードはブラウザ既定のrelying party IDに依存しています。`createPasskey`は`rp: { name }`だけを渡し`id`を指定しないため、IDはホスト名そのものです。**親ドメインを指す`id`を絶対に追加しないでください** — その親のすべてのサブドメインが同じ認証情報を使えるようになります。

## ヘッダー

同じポリシーを3つの形式で示します。使っているホストに合うものを選んでください。

Cloudflare Pages / Netlify 向けの`_headers`（サイトのルートに配置）:

```text
/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; frame-ancestors https://turbowarp.org; base-uri 'none'; form-action 'none'
  Permissions-Policy: camera=(self), bluetooth=(), geolocation=(), microphone=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Cross-Origin-Opener-Policy: same-origin
```

各行の意図:

- **`default-src 'none'`**（`connect-src`を書かない）により、**このページはネットワークリクエストを一切行えません。** keyholderは設計上サーバーへ接続しませんが、この設定はその主張をブラウザが強制する事実に変えます
- **`frame-ancestors`**はkeyholderの埋め込みを許すページを列挙します。自前でホストするTurboWarpやパッケージしたアプリがあれば加え、それ以外は書かないでください
- **`style-src 'unsafe-inline'`**が必要なのは`index.html`が`<style>`ブロックを持つからだけです。CSSをファイルへ切り出して落とすのは、やる価値のある引き締めです
- **`camera=(self)`**はペアリングが行われる最上位ページでカメラを許可します。埋め込み時に誤って有効化することはありません。クロスオリジンframeでは親が`allow="camera"`を付与する必要があり、TurboWarpはそれをしないからです
- **`bluetooth=()`**は、keyholderがBluetoothに一切触れないことを宣言します。それはTurboWarpページの仕事です

`Cross-Origin-Embedder-Policy`は設定しないでください。ここでは不要で、埋め込みを壊します。

## 自前のサーバーで運用する

前提は1つ、**専用のホスト名**をname-based virtual hostとして用意することだけです。既存ホスト名の下のパスでは境界になりませんし、ポートでは足りません（前述）。DNSレコードの取得だけが、他人の協力を要するかもしれない部分です。

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

    add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; frame-ancestors https://turbowarp.org; base-uri 'none'; form-action 'none'" always;
    add_header Permissions-Policy "camera=(self), bluetooth=(), geolocation=(), microphone=()" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;

    location / { try_files $uri $uri/ =404; }
}

server {
    listen 80;
    server_name keyholder.example.org;
    return 301 https://$host$request_uri;
}
```

**`location`ブロックの中に`add_header`を1つでも書くと、serverブロックから継承した`add_header`がすべて消えます。** `location /`はこのままにしてください。もし何か足すなら、全ヘッダーをそこにも書き直すことになります。`always`はエラーレスポンスにもヘッダーを付けるために必要です。

### Apache

`a2enmod headers`が必要です。

```apache
<VirtualHost *:443>
    ServerName keyholder.example.org
    DocumentRoot /var/www/sesame-keyholder

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/keyholder.example.org/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/keyholder.example.org/privkey.pem

    Header always set Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; frame-ancestors https://turbowarp.org; base-uri 'none'; form-action 'none'"
    Header always set Permissions-Policy "camera=(self), bluetooth=(), geolocation=(), microphone=()"
    Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains"
    Header always set Referrer-Policy "no-referrer"
    Header always set X-Content-Type-Options "nosniff"
    Header always set Cross-Origin-Opener-Policy "same-origin"

    <Directory /var/www/sesame-keyholder>
        Require all granted
        Options -Indexes -ExecCGI -Includes
        AllowOverride None
    </Directory>
</VirtualHost>
```

### 証明書の発行とリロード

```bash
# nginx
sudo certbot certonly --nginx -d keyholder.example.org
sudo nginx -t && sudo systemctl reload nginx

# Apache
sudo certbot certonly --apache -d keyholder.example.org
sudo apachectl configtest && sudo systemctl reload apache2
```

certbotは自前の更新タイマーを入れます。`systemctl list-timers | grep certbot`で有効なことを確認し、`sudo certbot renew --dry-run`で更新経路を一度通しで検証してください。証明書が切れれば鍵の操作ごと止まるので、「入っているはず」で済ませない価値があります。

### 自前サーバーに決める前に確認すべき3点

**到達性。** ブラウザは、**その錠前を使う場所から**keyholderへ到達できなければなりません。組織の内部からしか到達できないサーバーでは、自宅から開けたい錠前には使えません。最初に確認してください。ここを見落とすと最も時間を無駄にします。

**可用性が「ドアを開けられること」の前提条件になります。** Bluetoothセッションは、keyholderが読み込まれるまで始まりません。Bluetooth自体はネットワークに触れませんが、ページは触れます。計画停止や再起動が、そのまま鍵操作の停止になります。**keyholderにService Workerを持たせる価値は、ここが最も高くなります** — 一度キャッシュされればサーバー停止中でも読み込めます。

**名前の継続性。** 組織や勤務先のホスト名は、あなたの所有物ではありません。それが無くなれば保存済みの鍵もすべて失われます。さらに悪いことに、**後から別の誰かがそのホスト名を引き継いで別のサイトを立てると、その相手のページがあなたの保存済みsecretと同じoriginで動きます。** そのホストを運用から外すときは、名前が単に引き継がれないようにしてください。自分が持つドメインからの`CNAME`にしておけば、この問題全体を回避できます。

## デプロイ

keyholderはこのリポジトリのビルド成果物です。

```bash
pnpm run build
```

これが`src/keyholder/`から`docs/keyholder/keyholder.js`を生成します。`docs/keyholder/index.html`と`docs/keyholder/keyholder.js`をoriginの**ルート**に公開し、ページが`https://keyholder.example.org/`になるようにしてください。サブパスでも動きますが、URLが短いほど、鍵をスキャンして渡す前に「正しいサイトか」を確認しやすくなります。

```bash
rsync -av --delete docs/keyholder/ user@server:/var/www/sesame-keyholder/
```

**そのディレクトリに他のものを置かないでください。** その空白が境界の実体です。

ビルドは決定的で、両ファイルともコミットされています。したがって誰でもこのリポジトリをcloneし、`pnpm run build`を実行して、あなたが配信しているものと突き合わせられます。**自分で管理するハッシュを公開するより強い完全性の担保**であり、追加の仕組みを必要としません。

## プロジェクトを自分のoriginへ向ける

URLは3か所にあります。3つとも変更してから再ビルドしてください。

1. `src/block-definitions.json` — `KEYHOLDER_URL`の既定値。ブロックを新しくドラッグしたときに現れる値
2. `app/project.source.json` — スタンドアロンSB3の中のリテラル
3. `README.md`と`README.ja.md` — 文書化されたアドレス

```bash
pnpm run build && pnpm run check
```

既定値は機能拡張APIマニフェストに含まれないため、変更しても保存済みプロジェクトは壊れません。ただし**既存の`.sb3`は保存時のURLを保持します。** 古いスタンドアロンアプリは古いoriginへ接続し続けます。古いoriginに移転先を告げるページを置き続けるか、古い版が動かなくなることを受け入れるかを選んでください。

## 検証

初回デプロイ後と、ヘッダーを変更したあとに:

```bash
# ヘッダーが実際に送られているか
curl -sI https://keyholder.example.org/ | grep -iE 'content-security-policy|permissions-policy|strict-transport'

# 2つのファイルが、ブラウザが受け付けるContent-Typeで配信されているか
curl -sI https://keyholder.example.org/ | grep -i content-type            # text/html
curl -sI https://keyholder.example.org/keyholder.js | grep -i content-type # text/javascript

# 平文HTTPが何も配信せずリダイレクトするか
curl -sI http://keyholder.example.org/ | head -1

# ディレクトリの中身が一覧表示されないか
curl -s https://keyholder.example.org/ | grep -qi '<title>Sesame keyholder' && echo 'page ok'
```

`keyholder.js`が`text/plain`や`application/octet-stream`で配信されると、ブラウザはmoduleとして受け付けません。その場合、分かりやすいエラーではなく**白紙のページ**として現れます。

続いてブラウザで:

- keyholderを直接開く。鍵をペアリングでき、一覧に出ること
- スタンドアロンSB3をTurboWarpで開いて接続する。iframeが読み込まれ、セッションが始まること
- DevToolsのネットワークパネルを開いたまま1セッション通して使う。**初回読み込み以降、リクエストが1件も出ないこと。** ブロックされたリクエストはCSP違反として現れ、何かが外部通信を始めた合図になります
- 任意の別ページに`<iframe src="https://keyholder.example.org/">`を置く。**拒否されること。** 表示されるなら`frame-ancestors`が効いていません

## 運用

**名前を保ち続けることが、種類によらず最大の継続的リスクです。** 他人がその名前を制御するようになれば、その相手のページは、あなたが保存したラップ済みsecretと同じorigin・同じrelying party IDのもとで動きます。認証器での承認は依然として必要ですが、利用者には「見知らぬ相手に求められている」と見分ける術がありません。**名前の喪失は鍵の漏洩として扱ってください** — セサミアプリで共有鍵を削除し、新しい鍵をペアリングし直します。

したがって: 自分のドメインなら複数年で登録し、自動更新と移管ロックを有効にする。所有していない名前なら、**使うのをやめたときその名前がどうなるかを事前に把握しておく。** 有効期限や見直し日を、人間の目に触れる場所に記録してください。

**証明書の失効はアプリを停止させます。** iframeの読み込みが失敗し、すべてのセッションが道連れになります。自動更新し、「更新されたはず」と信じるのではなく証明書を監視してください。

**keyholderの更新**は2ファイルの再デプロイです。保存済みの鍵は残ります。ラップ済みsecretはそのoriginのIndexedDBにあり、originは変わっていないからです。デプロイ済みファイルを直接編集せず、このリポジトリから再ビルドしてください。

## 復旧と失効

**バックアップもエクスポートも存在しません。** これは意図的です。エクスポートできる鍵とは、持ち出せる鍵のことだからです。**バックアップはセサミアプリです。** ブラウザプロファイルを失った、消した、入れ替えた場合は、共有QRコードをもう一度スキャンしてペアリングします。

| 状況                                                     | 対応                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| サイトデータの消去、新しいPC、新しいブラウザプロファイル | セサミアプリから再ペアリング                                                                      |
| プライベートウィンドウ                                   | そこでは鍵が永続化されない。通常ウィンドウでペアリングする                                        |
| 認証器からパスキーを削除した                             | ラップ済みsecretはもう解けない。keyholderでデバイスを忘れ、再ペアリングする                       |
| originを変更した                                         | 全員が再ペアリング。パスキーはorigin間を移動しない                                                |
| originが侵害された疑い                                   | セサミアプリでペアリング済みの共有鍵を削除し、新しい鍵を共有する。keyholder側でもデバイスを忘れる |
| 共有した端末を紛失した                                   | セサミアプリでその共有鍵を削除する                                                                |

ご自身の環境で確認しておくべき点が1つあります。**アプリで削除した鍵を錠前がいつ受け付けなくなるかは、公開ドキュメントからは検証できませんでした。** Bluetooth経由では即座ではないと想定し、緊急の失効を削除操作だけに頼らないでください。確実な答えは、物理的な鍵交換か機器の取り外しです。

## このoriginで絶対にしてはならないこと

- 他のアプリケーション、ページ、リダイレクトを配信する
- アクセス解析、タグマネージャ、ウェブフォント、その他サードパーティのスクリプトを追加する。`default-src 'none'`がそれらを遮断しますが、それこそが目的です。動かすために緩めないでください
- `rp.id`を親ドメインに設定する
- `frame-ancestors`を`*`や、自分が管理していないホストへ広げる
- 平文HTTPで配信する。一時的でも、リダイレクト経路であってもです

## チェックリスト

- [ ] 専用のホスト名で、他に何も配信していない
- [ ] 保ち続けられる名前か、失ったときの手当てを決めてある名前である
- [ ] 証明書の自動更新付きHTTPS、証明書を監視
- [ ] ヘッダーをデプロイし、`curl -I`で確認済み
- [ ] `frame-ancestors`にkeyholderを埋め込むoriginだけが列挙されている
- [ ] 列挙外のoriginからの埋め込みが失敗することを確認済み
- [ ] 読み込み後にネットワークリクエストが無いことをDevToolsで確認済み
- [ ] 実際に錠前を使う場所から到達できる
- [ ] `KEYHOLDER_URL`を`src/block-definitions.json`、`app/project.source.json`、README 2本で更新済み
- [ ] `pnpm run check`が通り、再ビルドした成果物をコミット済み
- [ ] 旧originが説明付きでリダイレクトするか、意図して停止済み
- [ ] ペアリングとBluetoothセッションを端から端まで実機確認済み
