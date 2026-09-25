#!/usr/bin/env python3
"""見本の部品カタログ（mihon/parts/index.html）から、部品ごとの snippet.html を書き出す。

カタログの <!-- part:名前 --> と <!-- /part:名前 --> の間をそのまま切り出し、
- カタログだけで使う印（data-demo、data-days-ago）を外す
- 写真・音声のパスを、見本（mihon/<slug>/index.html）から見た ../parts/… に書き換える
- 先頭に「何を読み込めば動くか」のコメントを付ける
直すときはカタログを直してから、このスクリプトを流し直す（snippet.html を手で直さない）。

使い方: python3 tools/mihon_parts_snippets.py
"""
import re
from pathlib import Path

PARTS_DIR = Path(__file__).resolve().parent.parent / "mihon/parts"
CATALOG_URL = "https://freehp.jp/mihon/parts/"
FROM_SAMPLE = "../parts/"

# (名前, 表示名, JS があるか)
PARTS = [
    ("gallery", "写真ギャラリー", True),
    ("contact", "予約・問い合わせ", True),
    ("map", "地図", True),
    ("menu", "メニュー・料金表", True),
    ("voice", "音声・ボイスサンプル", True),
    ("faq", "よくある質問", False),
    ("news", "お知らせ", True),
    ("hearing", "聞き返し", True),
]


def header(name, label, has_js):
    lines = [
        "<!--",
        f"  部品: {label}（AIホームページ製作所 freehp.jp の見本用）",
        f"  動いている見本と使い方: {CATALOG_URL}#{name}",
        "  このファイルはカタログから自動で書き出したもの。直すときはカタログ（mihon/parts/index.html）を直して",
        "  tools/mihon_parts_snippets.py を流し直す。",
        "  見本（mihon/<slug>/index.html）に差し込むとき:",
        f'    <head> に  <link rel="stylesheet" href="{FROM_SAMPLE}tokens.css">',
        f'               <link rel="stylesheet" href="{FROM_SAMPLE}{name}/{name}.css">',
    ]
    if has_js:
        lines.append(f'    </body> の前に <script src="{FROM_SAMPLE}{name}/{name}.js"></script>')
    lines += [
        '    <body> に data-fhp-tone="aoba" などトーンを付ける（または tokens.css の変数を見本の :root に書く）',
        "-->",
    ]
    return "\n".join(lines) + "\n"


def convert(block):
    block = re.sub(r" data-demo(?=[\s>])", "", block)
    block = re.sub(r' data-days-ago="\d+"', "", block)
    block = re.sub(r'((?:src|data-large)=")(img/|voice/)', rf"\1{FROM_SAMPLE}\2", block)
    block = block.replace('data-catalog=""', f'data-catalog="{FROM_SAMPLE}"')
    return block


def main():
    catalog = (PARTS_DIR / "index.html").read_text(encoding="utf-8")
    for name, label, has_js in PARTS:
        m = re.search(rf"<!-- part:{name} -->\n(.*?)<!-- /part:{name} -->", catalog, re.S)
        if not m:
            raise SystemExit(f"カタログに part:{name} の印がありません")
        out = PARTS_DIR / name / "snippet.html"
        out.write_text(header(name, label, has_js) + convert(m.group(1)), encoding="utf-8")
        print(f"{out.relative_to(PARTS_DIR.parent.parent)}  {len(m.group(1))} bytes")


if __name__ == "__main__":
    main()
