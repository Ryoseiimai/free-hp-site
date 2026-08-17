#!/usr/bin/env python3
"""freehp.jp の Stripe 商品・価格・Payment Link を作成する。

stripe ライブラリは使わず、標準ライブラリの urllib だけで
https://api.stripe.com を form-encoded で直接叩く。

シークレットキーは ~/.freehp-stripe/.env の STRIPE_SECRET_KEY=sk_... から読み込み、
ログ・標準出力・例外メッセージには一切表示しない。

再実行しても安全（冪等）: 商品・価格・Payment Link のいずれも、
Stripe 側の metadata.freehp_key で既存のものを探し、あれば使い回す。

使い方:
    python3 stripe_setup.py --dry-run   # APIを呼ばず、作成予定の内容だけ表示
    python3 stripe_setup.py             # 実際に作成し、~/.freehp-stripe/links.json に保存
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

STRIPE_API_BASE = "https://api.stripe.com"
ENV_PATH = Path.home() / ".freehp-stripe" / ".env"
LINKS_PATH = Path.home() / ".freehp-stripe" / "links.json"

MISSING_KEY_MESSAGE = "鍵がありません。手順書を見てください。"

# このスクリプトが商品定義の唯一の正。
# recurring は None(一回払い) か "month"(毎月の定期)。
PRODUCTS: tuple[dict, ...] = (
    {
        "key": "freehp_seisaku",
        "name": "ホームページ制作（初回）",
        "amount": 10_000,
        "recurring": None,
    },
    {
        "key": "freehp_kanri",
        "name": "管理費（毎月）",
        "amount": 5_000,
        "recurring": "month",
    },
    {
        "key": "freehp_kigyo",
        "name": "起業応援 管理費（毎月）",
        "amount": 3_000,
        "recurring": "month",
    },
    {
        "key": "freehp_domain",
        "name": "独自ドメイン（取得・接続・初年度）",
        "amount": 10_000,
        "recurring": None,
    },
)

# 作成する Payment Link。products はまとめる商品 key のタプル。
PLAN_DEFS: tuple[dict, ...] = (
    {
        "key": "freehp_plan_normal",
        "label": "通常プラン",
        "products": ("freehp_seisaku", "freehp_kanri"),
    },
    {
        "key": "freehp_plan_kigyo",
        "label": "起業応援プラン",
        "products": ("freehp_kigyo",),
    },
    {
        "key": "freehp_plan_domain",
        "label": "独自ドメイン追加",
        "products": ("freehp_domain",),
    },
)

AFTER_MESSAGE = "お申し込みありがとうございます。翌営業日までにご連絡します。"
FIELD_LABEL = "お店・活動の名前"


class StripeError(RuntimeError):
    """Stripe API 呼び出しが失敗したときのエラー。"""


def load_secret_key(env_path: Path = ENV_PATH) -> str:
    """~/.freehp-stripe/.env からシークレットキーを読み込む。無ければ日本語で終了する。"""
    if not env_path.is_file():
        raise SystemExit(MISSING_KEY_MESSAGE)
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("STRIPE_SECRET_KEY="):
            key = line.split("=", 1)[1].strip()
            if key:
                return key
    raise SystemExit(MISSING_KEY_MESSAGE)


def _flatten(prefix: str, value: object, out: list[tuple[str, str]]) -> None:
    """Stripeのブラケット記法(a[b][0][c])にネスト構造を展開する。"""
    if isinstance(value, dict):
        for k, v in value.items():
            _flatten(f"{prefix}[{k}]", v, out)
    elif isinstance(value, (list, tuple)):
        for i, v in enumerate(value):
            _flatten(f"{prefix}[{i}]", v, out)
    elif value is None:
        return
    elif isinstance(value, bool):
        out.append((prefix, "true" if value else "false"))
    else:
        out.append((prefix, str(value)))


def encode_params(params: dict) -> str:
    pairs: list[tuple[str, str]] = []
    for key, value in params.items():
        _flatten(key, value, pairs)
    return urlencode(pairs)


def _error_message(body: str) -> str:
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return body
    return payload.get("error", {}).get("message", body)


def stripe_request(
    method: str,
    path: str,
    api_key: str,
    params: dict | None = None,
    idempotency_key: str | None = None,
) -> dict:
    url = f"{STRIPE_API_BASE}{path}"
    data: bytes | None = None
    if method == "GET":
        if params:
            url += "?" + encode_params(params)
    elif params:
        data = encode_params(params).encode("utf-8")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key

    request = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
    except HTTPError as error:
        body = error.read().decode("utf-8")
        raise StripeError(
            f"Stripe API エラー ({error.code}) {path}: {_error_message(body)}"
        ) from None
    except URLError as error:
        raise StripeError(f"Stripe に接続できません: {error}") from None
    return json.loads(body)


def _find_by_freehp_key(objects: list[dict], freehp_key: str) -> dict | None:
    for obj in objects:
        if obj.get("metadata", {}).get("freehp_key") == freehp_key:
            return obj
    return None


def get_or_create_product(api_key: str, freehp_key: str, name: str) -> dict:
    listing = stripe_request(
        "GET", "/v1/products", api_key, {"active": "true", "limit": 100}
    )
    existing = _find_by_freehp_key(listing.get("data", []), freehp_key)
    if existing:
        return existing
    return stripe_request(
        "POST",
        "/v1/products",
        api_key,
        {"name": name, "metadata": {"freehp_key": freehp_key}},
        idempotency_key=f"freehp-product-{freehp_key}",
    )


def get_or_create_price(
    api_key: str,
    freehp_key: str,
    product_id: str,
    amount: int,
    recurring: str | None,
) -> dict:
    listing = stripe_request(
        "GET", "/v1/prices", api_key, {"product": product_id, "limit": 100}
    )
    existing = _find_by_freehp_key(listing.get("data", []), freehp_key)
    if existing:
        return existing

    params: dict = {
        # JPY はゼロ・デシマル通貨のため unit_amount はそのまま円の数値。
        "unit_amount": amount,
        "currency": "jpy",
        "product": product_id,
        "tax_behavior": "inclusive",
        "metadata": {"freehp_key": freehp_key},
    }
    if recurring:
        params["recurring"] = {"interval": recurring}
    return stripe_request(
        "POST",
        "/v1/prices",
        api_key,
        params,
        idempotency_key=f"freehp-price-{freehp_key}",
    )


def build_payment_link_params(freehp_key: str, price_ids: list[str]) -> dict:
    return {
        "line_items": [{"price": price_id, "quantity": 1} for price_id in price_ids],
        "after_completion": {
            "type": "hosted_confirmation",
            "hosted_confirmation": {"custom_message": AFTER_MESSAGE},
        },
        "custom_fields": [
            {
                "key": "store_name",
                "label": {"type": "custom", "custom": FIELD_LABEL},
                "type": "text",
                "optional": False,
            }
        ],
        "phone_number_collection": {"enabled": True},
        "metadata": {"freehp_key": freehp_key},
    }


def get_or_create_payment_link(
    api_key: str, freehp_key: str, price_ids: list[str]
) -> dict:
    listing = stripe_request(
        "GET", "/v1/payment_links", api_key, {"active": "true", "limit": 100}
    )
    existing = _find_by_freehp_key(listing.get("data", []), freehp_key)
    if existing:
        return existing
    params = build_payment_link_params(freehp_key, price_ids)
    return stripe_request(
        "POST",
        "/v1/payment_links",
        api_key,
        params,
        idempotency_key=f"freehp-link-{freehp_key}",
    )


def _product_name(key: str) -> str:
    for definition in PRODUCTS:
        if definition["key"] == key:
            return definition["name"]
    return key


def _dry_run_preview() -> None:
    lines = ["[dry-run] 実際には Stripe API を呼びません。作成予定の内容:", ""]
    lines.append("[商品・価格]")
    for definition in PRODUCTS:
        kind = "定期(毎月)" if definition["recurring"] else "一回払い"
        lines.append(
            f"  - {definition['name']}: {definition['amount']:,}円 / {kind}"
            f" (key={definition['key']})"
        )
    lines.append("")
    lines.append("[Payment Link]")
    for plan in PLAN_DEFS:
        names = "、".join(_product_name(k) for k in plan["products"])
        lines.append(f"  - {plan['label']}: {names}")
    lines.append("")
    lines.append(f"[申込フォーム項目] {FIELD_LABEL}（必須）／電話番号収集：有効")
    lines.append(f"[完了メッセージ] {AFTER_MESSAGE}")
    print("\n".join(lines))


def setup(api_key: str, dry_run: bool = False) -> dict[str, str]:
    """商品・価格・Payment Link を作成/再利用し、{ラベル: URL} を返す。"""
    if dry_run:
        _dry_run_preview()
        return {}

    prices: dict[str, dict] = {}
    for definition in PRODUCTS:
        product = get_or_create_product(api_key, definition["key"], definition["name"])
        prices[definition["key"]] = get_or_create_price(
            api_key,
            definition["key"],
            product["id"],
            definition["amount"],
            definition["recurring"],
        )

    links: dict[str, str] = {}
    for plan in PLAN_DEFS:
        price_ids = [prices[key]["id"] for key in plan["products"]]
        try:
            link = get_or_create_payment_link(api_key, plan["key"], price_ids)
            links[plan["label"]] = link["url"]
        except StripeError:
            if len(price_ids) <= 1:
                raise
            # 定期＋一回払いの同居がエラーになる場合は、商品ごとに分けて作る。
            for product_key, price_id in zip(plan["products"], price_ids):
                sub_key = f"{plan['key']}__{product_key}"
                sub_label = f"{plan['label']}（{_product_name(product_key)}）"
                sub_link = get_or_create_payment_link(api_key, sub_key, [price_id])
                links[sub_label] = sub_link["url"]

    return links


def save_links(links: dict[str, str], path: Path = LINKS_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(links, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="freehp.jp の Stripe Payment Links を作成する"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="APIを呼ばず、作成予定の内容を表示するだけ",
    )
    args = parser.parse_args(argv)

    if args.dry_run:
        setup("", dry_run=True)
        return 0

    api_key = load_secret_key()
    try:
        links = setup(api_key, dry_run=False)
    except StripeError as error:
        print(f"エラー: {error}", file=sys.stderr)
        return 1

    save_links(links)
    print("Stripe の支払いリンクを作成しました。")
    for label, url in links.items():
        print(f"  {label}: {url}")
    print(f"\n保存先: {LINKS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
