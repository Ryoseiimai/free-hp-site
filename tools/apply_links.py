#!/usr/bin/env python3
"""~/.freehp-stripe/links.json の支払いリンクを index.html / company.html に差し込む。

事前に index.html / company.html へ <!-- STRIPE_LINKS --> というプレースホルダの
コメントを1箇所ずつ置いておく（このスクリプト自身は置かない）。

- links.json がまだ無い/空 → 何もせず終了（プレースホルダはそのまま）。
- 初回 → プレースホルダを <!-- STRIPE_LINKS:START -->〜<!-- STRIPE_LINKS:END --> の
  ブロックに置き換える。
- 2回目以降 → 既存のブロックを丸ごと新しい内容に置き換える（冪等・再実行OK）。

このスクリプトは書き換えのみ行い、git push はしない。

使い方:
    python3 tools/apply_links.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINKS_PATH = Path.home() / ".freehp-stripe" / "links.json"

PLACEHOLDER = "<!-- STRIPE_LINKS -->"
BLOCK_START = "<!-- STRIPE_LINKS:START -->"
BLOCK_END = "<!-- STRIPE_LINKS:END -->"

# ファイル名 -> 挿入するHTMLの見た目のスタイル種別
TARGETS: dict[str, str] = {
    "index.html": "index",
    "company.html": "company",
}


def _link_text(label: str) -> str:
    return f"{label}のお支払いへ（Stripe）"


def build_block(links: dict[str, str], style: str) -> str:
    if style == "index":
        items = "\n".join(
            f'      <a class="button secondary-action" href="{url}"'
            f' target="_blank" rel="noopener noreferrer">{_link_text(label)}</a>'
            for label, url in links.items()
        )
        body = f'    <div class="stripe-links">\n{items}\n    </div>'
    else:
        items = "\n".join(
            f'    <li><a href="{url}" target="_blank"'
            f' rel="noopener noreferrer">{_link_text(label)}</a></li>'
            for label, url in links.items()
        )
        body = f'  <ul class="stripe-links">\n{items}\n  </ul>'

    return f"{BLOCK_START}\n{body}\n{BLOCK_END}"


def apply_to_file(path: Path, links: dict[str, str], style: str) -> bool:
    text = path.read_text(encoding="utf-8")
    block = build_block(links, style)

    if BLOCK_START in text and BLOCK_END in text:
        start = text.index(BLOCK_START)
        end = text.index(BLOCK_END) + len(BLOCK_END)
        new_text = text[:start] + block + text[end:]
    elif PLACEHOLDER in text:
        new_text = text.replace(PLACEHOLDER, block, 1)
    else:
        raise SystemExit(f"プレースホルダが見つかりません: {path}")

    if new_text == text:
        return False
    path.write_text(new_text, encoding="utf-8")
    return True


def main() -> int:
    if not LINKS_PATH.is_file():
        print(f"{LINKS_PATH} がまだありません。先に tools/stripe_setup.py を実行してください。")
        return 0

    links: dict[str, str] = json.loads(LINKS_PATH.read_text(encoding="utf-8"))
    if not links:
        print("links.json が空です。何もしません。")
        return 0

    changed: list[str] = []
    for filename, style in TARGETS.items():
        path = ROOT / filename
        if not path.is_file():
            print(f"見つかりません: {path}", file=sys.stderr)
            continue
        if apply_to_file(path, links, style):
            changed.append(filename)

    if changed:
        print("差し込みました: " + ", ".join(changed))
    else:
        print("変更はありませんでした（すでに最新の内容です）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
