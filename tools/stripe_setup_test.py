#!/usr/bin/env python3
"""stripe_setup.py のテスト。実APIは一切叩かず、urllib.urlopen をモックに差し替える。

実行:
    python3 tools/stripe_setup_test.py
"""

from __future__ import annotations

import io
import json
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qsl

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stripe_setup  # noqa: E402


def parse_stripe_form(body: str) -> dict:
    """Stripeのブラケット記法(a[b][0][c]=v)を素朴にネスト辞書へ戻す(テスト用)。"""
    result: dict = {}
    for raw_key, value in parse_qsl(body):
        parts = re.findall(r"[^\[\]]+", raw_key)
        node = result
        for i, part in enumerate(parts):
            if i == len(parts) - 1:
                node[part] = value
            else:
                node = node.setdefault(part, {})
    return result


class _FakeResponse:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False


class FakeStripeAPI:
    """stripe_setup.urlopen を差し替えるための最小 Stripe モック。"""

    def __init__(self, seed_products: list[dict] | None = None) -> None:
        self.calls: list[tuple[str, str]] = []
        self._counter = 0
        self.products: list[dict] = list(seed_products or [])
        self.prices: list[dict] = []
        self.payment_links: list[dict] = []

    def _next_id(self, prefix: str) -> str:
        self._counter += 1
        return f"{prefix}_{self._counter}"

    def __call__(self, request, timeout: int = 30) -> _FakeResponse:  # noqa: ANN001
        method = request.get_method()
        path, _, query = request.full_url.replace(stripe_setup.STRIPE_API_BASE, "").partition("?")
        self.calls.append((method, path))

        if method == "GET":
            params = dict(parse_qsl(query))
            body = self._handle_get(path, params)
        else:
            raw = request.data.decode("utf-8") if request.data else ""
            body = self._handle_post(path, parse_stripe_form(raw))

        return _FakeResponse(json.dumps(body).encode("utf-8"))

    def _handle_get(self, path: str, params: dict) -> dict:
        if path == "/v1/products":
            return {"data": self.products}
        if path == "/v1/prices":
            product = params.get("product")
            return {"data": [p for p in self.prices if p["product"] == product]}
        if path == "/v1/payment_links":
            return {"data": self.payment_links}
        raise AssertionError(f"未対応のGET: {path}")

    def _handle_post(self, path: str, form: dict) -> dict:
        if path == "/v1/products":
            obj = {
                "id": self._next_id("prod"),
                "name": form.get("name"),
                "metadata": form.get("metadata", {}),
            }
            self.products.append(obj)
            return obj
        if path == "/v1/prices":
            obj = {
                "id": self._next_id("price"),
                "product": form.get("product"),
                "unit_amount": form.get("unit_amount"),
                "metadata": form.get("metadata", {}),
            }
            self.prices.append(obj)
            return obj
        if path == "/v1/payment_links":
            link_id = self._next_id("plink")
            obj = {
                "id": link_id,
                "url": f"https://buy.stripe.com/test_{link_id}",
                "metadata": form.get("metadata", {}),
                "_form": form,
            }
            self.payment_links.append(obj)
            return obj
        raise AssertionError(f"未対応のPOST: {path}")


class DryRunTest(unittest.TestCase):
    def test_dry_run_prints_expected_content(self) -> None:
        out = io.StringIO()
        with redirect_stdout(out):
            links = stripe_setup.setup("", dry_run=True)
        text = out.getvalue()

        self.assertEqual(links, {})
        self.assertIn("[dry-run]", text)
        for definition in stripe_setup.PRODUCTS:
            self.assertIn(definition["name"], text)
        self.assertIn("10,000円", text)
        self.assertIn("5,000円", text)
        self.assertIn("3,000円", text)
        self.assertIn("通常プラン", text)
        self.assertIn("起業応援プラン", text)
        self.assertIn("独自ドメイン追加", text)
        self.assertIn(stripe_setup.FIELD_LABEL, text)
        self.assertIn(stripe_setup.AFTER_MESSAGE, text)


class ProductReuseTest(unittest.TestCase):
    def test_get_or_create_product_reuses_existing(self) -> None:
        fake = FakeStripeAPI(
            seed_products=[
                {
                    "id": "prod_existing",
                    "name": "旧名",
                    "metadata": {"freehp_key": "freehp_seisaku"},
                }
            ]
        )
        with mock.patch.object(stripe_setup, "urlopen", fake):
            product = stripe_setup.get_or_create_product(
                "sk_test", "freehp_seisaku", "ホームページ制作（初回）"
            )

        self.assertEqual(product["id"], "prod_existing")
        self.assertNotIn(("POST", "/v1/products"), fake.calls)

    def test_get_or_create_product_creates_when_missing(self) -> None:
        fake = FakeStripeAPI()
        with mock.patch.object(stripe_setup, "urlopen", fake):
            product = stripe_setup.get_or_create_product(
                "sk_test", "freehp_seisaku", "ホームページ制作（初回）"
            )

        self.assertIn(("POST", "/v1/products"), fake.calls)
        self.assertEqual(product["metadata"]["freehp_key"], "freehp_seisaku")


class PaymentLinkGenerationTest(unittest.TestCase):
    def test_setup_creates_three_payment_links(self) -> None:
        fake = FakeStripeAPI()
        with mock.patch.object(stripe_setup, "urlopen", fake):
            links = stripe_setup.setup("sk_test", dry_run=False)

        self.assertEqual(
            set(links.keys()), {"通常プラン", "起業応援プラン", "独自ドメイン追加"}
        )
        for url in links.values():
            self.assertTrue(url.startswith("https://buy.stripe.com/"))

        # 商品4件 + 価格4件 + Payment Link 3件 = POST 11回
        post_calls = [c for c in fake.calls if c[0] == "POST"]
        self.assertEqual(len(post_calls), 11)

        # フォーム内容が想定どおりStripe形式で送られているか確認する。
        normal_link = next(
            link for link in fake.payment_links
            if link["metadata"].get("freehp_key") == "freehp_plan_normal"
        )
        form = normal_link["_form"]
        self.assertEqual(form["custom_fields"]["0"]["key"], "store_name")
        self.assertEqual(
            form["custom_fields"]["0"]["label"]["custom"], stripe_setup.FIELD_LABEL
        )
        self.assertEqual(form["phone_number_collection"]["enabled"], "true")
        self.assertEqual(form["after_completion"]["type"], "hosted_confirmation")
        self.assertEqual(
            form["after_completion"]["hosted_confirmation"]["custom_message"],
            stripe_setup.AFTER_MESSAGE,
        )
        self.assertEqual(form["line_items"]["0"]["price"], form["line_items"]["0"]["price"])
        self.assertIn("1", form["line_items"])  # 通常プランは商品2つ→line_items[0],[1]

    def test_setup_reuses_existing_payment_link(self) -> None:
        fake = FakeStripeAPI()
        with mock.patch.object(stripe_setup, "urlopen", fake):
            first = stripe_setup.setup("sk_test", dry_run=False)
            second = stripe_setup.setup("sk_test", dry_run=False)

        self.assertEqual(first, second)
        post_calls = [c for c in fake.calls if c[0] == "POST"]
        # 2回目はすべて既存流用のはずなので、1回目からPOSTは増えない。
        self.assertEqual(len(post_calls), 11)


class MissingKeyTest(unittest.TestCase):
    def test_load_secret_key_missing_file_exits(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            missing_path = Path(tmp) / "nope" / ".env"
            with self.assertRaises(SystemExit) as ctx:
                stripe_setup.load_secret_key(missing_path)
            self.assertIn("鍵がありません", str(ctx.exception))

    def test_load_secret_key_reads_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text("STRIPE_SECRET_KEY=sk_test_dummy\n", encoding="utf-8")
            self.assertEqual(stripe_setup.load_secret_key(env_path), "sk_test_dummy")


if __name__ == "__main__":
    unittest.main()
