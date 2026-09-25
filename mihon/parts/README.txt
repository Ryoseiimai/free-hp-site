ホームページに貼れる部品（AIホームページ製作所 freehp.jp）
====================================================

コピーして貼るだけで動く、ホームページの部品8種。誰でも無料で使えます（ライセンスは LICENSE）。
全部品を動かして並べたカタログ: index.html（https://freehp.jp/mihon/parts/）

いちばん簡単な使い方（3手順）
  1. 使いたい部品のフォルダの copy.html を開き、中身をまるごとコピーする
  2. 自分のページの、置きたい場所に貼り付ける
  3. 貼ったコードの上のほうにある色（--fhp- で始まる行）を、お店の色に書き換える

どの要望にどの部品か
  「写真をたくさん見せたい」          → gallery/  写真ギャラリー
  「電話やLINEで予約を受けたい」      → contact/  予約・問い合わせ
  「場所が分かりにくいと言われる」    → map/      地図
  「メニューと料金を載せたい」        → menu/     メニュー・料金表
  「ボイスサンプルを聞けるようにしたい」→ voice/    音声・ボイスサンプル
  「同じ質問を何度もされる」          → faq/      よくある質問
  「休みや新作を知らせたい」          → news/     お知らせ
  「何を載せればいいか分からない」    → hearing/  聞き返し

freehp の見本（mihon/<slug>/）への差し込み方（どの部品も同じ）
  1. <head> で tokens.css と <部品>/<部品>.css を読み込む
  2. <部品>/snippet.html の中身を、見本の入れたい場所に貼り、文言・写真・リンク先を差し替える
  3. </body> の前で <部品>/<部品>.js を読み込む（faq は JS なし）
  4. 見本の <body> に data-fhp-tone="aoba"（または genkido / soramame）を付ける。
     別のトーンにしたいときは tokens.css の変数（--fhp-bg など）を見本の :root に書く

決まりごと
  - 外部のライブラリは使わない。送信するフォームは作らない（予約・問い合わせは外のページや電話につなぐだけ）
  - snippet.html・copy.html・freehp-parts.zip は手で直さない。カタログや各 CSS/JS を直してから
    python3 tools/mihon_parts_snippets.py を流す
  - 写真・音声を作り直すときは python3 tools/mihon_parts_assets.py
  - 検品（撮影・横スクロール・コンソール・キーボード操作・スワイプ）は python3 tools/mihon_parts_check.py
