# Stripe 決済リンク（freehp.jp）

freehp.jp（AIホームページ製作所）の支払いを Stripe で受けるための一式。stripe ライブラリは使わず、`tools/stripe_setup.py` が標準ライブラリの urllib だけで Stripe API を form-encoded で叩く。

## 全体の流れ

1. 本人が Stripe アカウントを `kaeru3160@gmail.com` で新規作成し、シークレットキー（`sk_live_...`）を `~/.freehp-stripe/.env` に保存する（`~/Desktop/freehp-Stripe設定.html` の手順どおり）。
2. `python3 tools/stripe_setup.py` を実行する。Product（4件）・Price（4件）・Payment Link（3本）を作成し、`~/.freehp-stripe/links.json` に `{ラベル: URL}` で保存する。再実行しても既存のものを使い回すので何度実行しても安全。
3. `python3 tools/apply_links.py` を実行する。`links.json` の内容を `index.html`（申込ボタン付近）と `company.html`（料金説明の下）に差し込む。差し込み先には `<!-- STRIPE_LINKS -->` というプレースホルダのコメントを事前に置いてあり、初回はそこを置き換え、2回目以降は前回挿入したブロックごと置き換える（冪等）。
4. 差分を確認して問題なければコミット・デプロイする（このツール自体は push しない）。

## 鍵の置き場所

- `~/.freehp-stripe/.env`（パーミッション600推奨）に1行だけ `STRIPE_SECRET_KEY=sk_live_...`。
- 鍵が無い状態で `stripe_setup.py` を実行すると「鍵がありません。手順書を見てください。」と表示して終了する（API は一切呼ばない）。
- 鍵はログ・標準出力・エラーメッセージのどこにも出力しない。

## 作られる商品・価格

| key | 名前 | 金額 | 種別 |
|---|---|---|---|
| freehp_seisaku | ホームページ制作（初回） | 10,000円 | 一回払い |
| freehp_kanri | 管理費（毎月） | 5,000円 | 定期(毎月) |
| freehp_kigyo | 起業応援 管理費（毎月） | 3,000円 | 定期(毎月) |
| freehp_domain | 独自ドメイン（取得・接続・初年度） | 10,000円 | 一回払い |

## 作られる Payment Link

- **通常プラン** = 制作(初回) + 管理費(毎月)。定期＋一回払いの同居が Stripe 側でエラーになる場合は自動的に商品ごとの2本（「通常プラン（ホームページ制作（初回）」「通常プラン（管理費（毎月））」）に分けて作る。
- **起業応援プラン** = 起業応援の管理費（毎月）のみ。
- **独自ドメイン追加** = 独自ドメインの一回払いのみ。

各リンクには「お店・活動の名前」の必須入力欄と電話番号収集を付け、完了後に「お申し込みありがとうございます。翌営業日までにご連絡します。」を表示する。

## 再実行の仕方

- 商品名や金額を変えたいときは `stripe_setup.py` の `PRODUCTS` / `PLAN_DEFS` を編集して再実行する。既存の Product/Price/Payment Link は `metadata.freehp_key` で探して再利用するため、同じ key のままなら重複作成されない。金額を変えたい場合は Stripe の Price は不変（Immutable）なので、key を変える（例: `freehp_kanri_v2`）と新しい Price・新しい Payment Link が作られる。
- リンクを HTML に反映し直したいときは `apply_links.py` を再実行するだけでよい（前回挿入分を丸ごと置き換える）。

## リンクの差し替え方

- `~/.freehp-stripe/links.json` を直接書き換えてから `apply_links.py` を実行すれば、任意の URL に差し替えられる。
- HTML 側のプレースホルダ・挿入位置：
  - `index.html`: 申込フォームの `apply-button`（送信ボタン）の下、`privacy-note` の直後。
  - `company.html`: 「お約束」テーブル（料金説明を含む）の直後、戻るリンクの手前。

## テスト

```
python3 tools/stripe_setup_test.py
```

実 API は一切叩かず、`urlopen` を差し替えたモックで dry-run 表示・Product 再利用・Payment Link 3本生成・鍵なし終了を検証する。

## 未着手（次の課題）

- 解約導線（Stripe カスタマーポータル）の設定はまだ行っていない。管理費の定期支払いを本人都合で止めたい問い合わせが来たときのために、Customer Portal の有効化と `apply_links.py` からのリンク掲出を別途検討する。
