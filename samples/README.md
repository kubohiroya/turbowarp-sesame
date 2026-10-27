# read-device-status

1. Editorで開き、**Run without sandbox**を選択して拡張を許可します。緑旗はローカル状態の初期化だけです。
2. localhost relayでproviderを設定して起動し、**Configure**をクリック。ループバックoriginと機器alias、8桁の一回限りのコードを入力します。API keyは入力しません。最後の確認では空欄のままEnterを押し、入力したコードを消します。
3. **Relay paired = true**を確認して**Read**をクリック。batteryPercentageだけ取得します。施錠/解錠/toggleブロックは含みません。
4. **Stop / Clear**で終了し設定・結果を消去。保存・共有前に空欄回答とClearを実行してください。元のサンプルを開き直すと入力は空に戻ります。

## 要件

localhost keybroker、設定済みSesame alias、Candy House認証情報をrelay側に設定、cloud経由で到達できる実Sesame機器（対応Wi-Fi接続等）。状態取得のみ。

## 未検証

実relayペアリング、Candy House API疎通、機器の電池値・状態の実取得は未検証。施錠・解錠・toggleはデモに含めない。
自動検証ではrelay接続・マイク取得・発話・機器操作を開始しません。成功結果を事前保存しません。relay内のAPI key/tokenはこのファイルに入れません。

## 再生成

`read-device-status/project.json` とSVGを編集し、Node.js 26で `node scripts/build-samples.mjs`、`node scripts/build-samples.mjs --check`、`node --test scripts/verify-samples.mjs`。SB3は固定時刻のZIP、distの確認済みJSを同梱します。`node scripts/prepare-pages.mjs` が既存docsとdist/SB3を `_site/` に複製します。本体やフラグ既定値は変更しません。
