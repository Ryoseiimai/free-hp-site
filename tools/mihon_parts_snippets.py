#!/usr/bin/env python3
"""部品カタログ（mihon/parts/index.html）から、配るためのファイルを書き出す。

1. <部品>/snippet.html  freehp の見本（mihon/<slug>/）に差し込む用。CSS・JS は別ファイルで読み込む
2. <部品>/copy.html     誰でもコピーして貼るだけで動く用。トークン・CSS・HTML・JS を1まとまりにし、
                        写真・音声は https://freehp.jp/mihon/parts/ の絶対URLにする（カタログの「コードをコピー」の中身）
3. freehp-parts.zip     全部品と素材・カタログ・ライセンスをまとめたもの

カタログの <!-- part:名前 --> と <!-- /part:名前 --> の間を切り出し、カタログだけで使う印（data-demo、
data-days-ago）を外して使う。直すときはカタログや各 CSS/JS を直してから、このスクリプトを流し直す
（snippet.html・copy.html・zip は手で直さない）。

使い方: python3 tools/mihon_parts_snippets.py
"""
import re
import zipfile
from pathlib import Path

PARTS_DIR = Path(__file__).resolve().parent.parent / "mihon/parts"
PUBLIC_URL = "https://freehp.jp/mihon/parts/"
FROM_SAMPLE = "../parts/"
ZIP_NAME = "freehp-parts.zip"
ZIP_ROOT = "freehp-parts"
# zip の中身の日時を固定する（中身が同じなら zip も同じになるように）
ZIP_DATE = (2026, 9, 25, 0, 0, 0)
ZIP_SKIP_SUFFIX = {".zip", ".pyc"}
ZIP_SKIP_NAMES = {"ogp.png"}
COPYRIGHT = "Copyright (c) 2026 RYOSEIWORKS (Ryosei Imai)"

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


def strip_demo(block):
    block = re.sub(r" data-demo(?=[\s>])", "", block)
    return re.sub(r' data-days-ago="\d+"', "", block)


def point_assets(block, base):
    block = re.sub(r'((?:src|data-large)=")(img/|voice/)', rf"\1{base}\2", block)
    return block.replace('data-catalog=""', f'data-catalog="{base}"')


def snippet_header(name, label, has_js):
    lines = [
        "<!--",
        f"  部品: {label}（AIホームページ製作所 freehp.jp の見本用）",
        f"  動いている見本と使い方: {PUBLIC_URL}#{name}",
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


def copy_bundle(name, label, has_js, block):
    head = "\n".join([
        "<!--",
        f"  {label}（AIホームページ製作所がつくった、無料で使える部品）",
        f"  動いている見本: {PUBLIC_URL}#{name}",
        "  使い方",
        "    1. このコードをまるごと、自分のページの置きたい場所に貼る",
        "    2. すぐ下の :root { ... } にある色（--fhp- で始まる行）を、お店の色に書き換える",
        "    3. 文字・写真・リンク先を、自分のお店のものに書き換える",
        "  写真と音声は見本用の仮のものです（実在するお店の商品として使わないでください）。",
        f"  {COPYRIGHT}. MIT No Attribution（MIT-0）。商用・改変・再配布も自由で、表記は要りません。",
        "-->",
    ])
    css = (PARTS_DIR / "tokens.css").read_text(encoding="utf-8").rstrip()
    css += "\n\n" + (PARTS_DIR / name / f"{name}.css").read_text(encoding="utf-8").rstrip()
    out = [head, "<style>", css, "</style>", point_assets(block, PUBLIC_URL).rstrip()]
    if has_js:
        js = (PARTS_DIR / name / f"{name}.js").read_text(encoding="utf-8").rstrip()
        out += ["<script>", js, "</script>"]
    return "\n".join(out) + "\n"


def build_zip():
    target = PARTS_DIR / ZIP_NAME
    files = sorted(p for p in PARTS_DIR.rglob("*")
                   if p.is_file() and p.suffix not in ZIP_SKIP_SUFFIX and p.name not in ZIP_SKIP_NAMES
                   and "__pycache__" not in p.parts)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            info = zipfile.ZipInfo(f"{ZIP_ROOT}/{p.relative_to(PARTS_DIR).as_posix()}", ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, p.read_bytes())
    print(f"{target.name}  {len(files)} files  {target.stat().st_size // 1024} KB")


def main():
    catalog = (PARTS_DIR / "index.html").read_text(encoding="utf-8")
    for name, label, has_js in PARTS:
        m = re.search(rf"<!-- part:{name} -->\n(.*?)<!-- /part:{name} -->", catalog, re.S)
        if not m:
            raise SystemExit(f"カタログに part:{name} の印がありません")
        block = strip_demo(m.group(1))
        (PARTS_DIR / name / "snippet.html").write_text(
            snippet_header(name, label, has_js) + point_assets(block, FROM_SAMPLE), encoding="utf-8")
        (PARTS_DIR / name / "copy.html").write_text(copy_bundle(name, label, has_js, block), encoding="utf-8")
        print(f"{name}: snippet.html / copy.html")
    build_zip()


if __name__ == "__main__":
    main()
