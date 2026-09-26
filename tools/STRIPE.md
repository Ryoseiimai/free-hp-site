# Stripe 決済リンク（freehp.jp）

freehp.jp（AIホームページ製作所）の支払いを Stripe で受けるための一式。stripe ライブラリは使わず、`tools/stripe_setup.py` が標準ライブラリの urllib だけで Stripe API を form-encoded で叩く。

## 全体の流れ（2026-09-27〜の新料金：制作0円・運用費 年3,000円・独自ドメインは実費・応援は任意）

1. 本人が Stripe アカウントを `kaeru3160@gmail.com` で新規作成し、シークレットキー（`sk_live_...`）を `~/.freehp-stripe/.env` に保存する（`~/Desktop/freehp-Stripe設定.html` の手順どおり）。鍵がまだ無い場合はこのファイルを配置するところから始める。
2. `python3 tools/stripe_setup.py --dry-run` で作成予定の内容（商品・金額・Payment Link）を確認する。
3. `python3 tools/stripe_setup.py` を実行する。Product・Price（新料金2件：運用費 freehp_unyo_v1／応援 freehp_ouen_v1。旧料金4件は互換のため定義に残るが新規実行では使わない想定）・Payment Link（2本：運用費／応援）を作成し、`~/.freehp-stripe/links.json` に `{ラベル: URL}` で保存する。再実行しても既存のものを使い回すので何度実行しても安全。独自ドメインは実費（原価）のため固定価格の Payment Link は作らない。申込フォーム（`domain.html`）の内容を見て個別に金額を確認し、Stripe の invoice（請求書）またはその都度の Payment Link で個別請求する。
4. `python3 tools/apply_links.py` を実行する。`links.json` の内容を `index.html`（申込ボタン付近）と `company.html`（料金説明の下）に差し込む。差し込み先には `<!-- STRIPE_LINKS -->` というプレースホルダのコメントを事前に置いてあり、初回はそこを置き換え、2回目以降は前回挿入したブロックごと置き換える（冪等）。ラベルは `PLAN_DEFS` の `label`（「運用費（年3,000円）」「応援（任意）」）がそのまま使われる。
5. 差分を確認して問題なければコミット・デプロイする（このツール自体は push しない）。

## 鍵の置き場所

- `~/.freehp-stripe/.env`（パーミッション600推奨）に1行だけ `STRIPE_SECRET_KEY=sk_live_...`。
- 鍵が無い状態で `stripe_setup.py` を実行すると「鍵がありません。手順書を見てください。」と表示して終了する（API は一切呼ばない）。
- 鍵はログ・標準出力・エラーメッセージのどこにも出力しない。

## 作られる商品・価格

| key | 名前 | 金額 | 種別 |
|---|---|---|---|
| freehp_seisaku | ホームページ制作（初回・旧料金） | 10,000円 | 一回払い（新規では使わない） |
| freehp_kanri | 管理費（毎月・旧料金） | 5,000円 | 定期(毎月)（新規では使わない） |
| freehp_kigyo | 起業応援 管理費（毎月・旧料金） | 3,000円 | 定期(毎月)（新規では使わない） |
| freehp_domain | 独自ドメイン（取得・接続・初年度・旧料金） | 10,000円 | 一回払い（新規では使わない。実費のため固定価格は作らない） |
| freehp_unyo_v1 | 運用費（年額） | 3,000円 | 定期(年次) |
| freehp_ouen_v1 | 応援（任意） | 顧客が選択（最低500円・既定3,000円） | 一回払い（custom_unit_amount） |

旧4件（freehp_seisaku／freehp_kanri／freehp_kigyo／freehp_domain）は `PRODUCTS` に残したまま、コメントで「旧料金・新規では使わない」と明記している。既存契約の照会・解約導線のためだけに参照する。

## 作られる Payment Link

- **運用費（年3,000円）** = `freehp_unyo_v1` の年次サブスクリプションのみ。
- **応援（任意）** = `freehp_ouen_v1` の単発（金額は顧客が選択・最低500円・既定3,000円）のみ。
- 独自ドメインは実費（原価）のため Payment Link は作らない。`domain.html` の申込フォーム経由で内容を確認し、個別に請求する。

各リンクには「お店・活動の名前」の必須入力欄と電話番号収集を付け、完了後に「お申し込みありがとうございます。翌営業日までにご連絡します。」を表示する。応援（`freehp_ouen_v1`）は custom_unit_amount の価格のため、line_item に quantity を固定しない（Stripe 側で顧客が金額を入力するUIになる）。

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

- 解約導線（Stripe カスタマーポータル）の設定はまだ行っていない。運用費（年額）の自動更新を本人都合で止めたい問い合わせが来たときのために、Customer Portal の有効化と `apply_links.py` からのリンク掲出を別途検討する。
- 独自ドメインの個別請求フロー（申込フォーム→金額確認→Invoice発行）は未実装。今は `domain.html` のフォーム内容をもとに手作業で請求する想定。
- 新料金（`freehp_unyo_v1`／`freehp_ouen_v1`）は `stripe_setup.py` をまだ実行していない（鍵 `~/.freehp-stripe/.env` が未配置）。実行後は `apply_links.py` で `index.html`／`company.html` のリンクURLを実物に差し替えること。
