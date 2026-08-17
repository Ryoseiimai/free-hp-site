#!/usr/bin/env python3
"""freehp.jp の料金・表現ルールを検査する。"""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FACTS_PATH = Path.home() / ".freehp-content" / "facts.md"
FORBIDDEN = (
    "無料",
    "0円で公開",
    "タダ",
    "業界最安",
    "必ず",
    "誰でも",
    "1,500円前後",
    "月3,000円",
)
STARTUP_CONTEXT = ("起業応援", "初期0円")
INDEX_REQUIRED_PRICES = ("10,000円", "5,000円", "3,000円")


class MetadataParser(HTMLParser):
    """title と og:site_name の表示文字列だけを取り出す。"""

    def __init__(self) -> None:
        super().__init__()
        self.in_title = False
        self.titles: list[str] = []
        self.og_site_names: list[str] = []

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag.lower() == "title":
            self.in_title = True
        if tag.lower() != "meta":
            return
        values = dict(attrs)
        if values.get("property") == "og:site_name":
            self.og_site_names.append(values.get("content") or "")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.titles.append(data)


def html_files() -> list[Path]:
    return sorted(
        path
        for path in ROOT.rglob("*.html")
        if path.name != "ryoseiworks.html" and ".bak-" not in path.name
    )


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def main() -> None:
    targets = html_files()
    assert FACTS_PATH.is_file(), f"facts.md が見つかりません: {FACTS_PATH}"
    scan_targets = [*targets, FACTS_PATH]

    wording_errors: list[str] = []
    for path in scan_targets:
        for line_number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            found = [word for word in FORBIDDEN if word in line]
            if found and not any(context in line for context in STARTUP_CONTEXT):
                wording_errors.append(
                    f"{display_path(path)}:{line_number}: {', '.join(found)}"
                )
    assert not wording_errors, "禁止表現があります:\n" + "\n".join(wording_errors)

    index_text = (ROOT / "index.html").read_text(encoding="utf-8")
    missing_prices = [
        price for price in INDEX_REQUIRED_PRICES if price not in index_text
    ]
    assert not missing_prices, "index.html に不足している金額: " + ", ".join(
        missing_prices
    )

    metadata_errors: list[str] = []
    for path in targets:
        parser = MetadataParser()
        parser.feed(path.read_text(encoding="utf-8"))
        values = [*parser.titles, *parser.og_site_names]
        if any("無料" in value for value in values):
            metadata_errors.append(display_path(path))
    assert not metadata_errors, "title/og:site_name に禁止表現があります: " + ", ".join(
        metadata_errors
    )

    print(f"OK: {len(targets)} HTML files + {FACTS_PATH}")
    print("OK: 禁止表現は起業応援プランの文脈外にありません")
    print("OK: index.html に 10,000円・5,000円・3,000円があります")
    print("OK: title/og:site_name に『無料』はありません")
    print("All pricing checks passed.")


if __name__ == "__main__":
    main()
