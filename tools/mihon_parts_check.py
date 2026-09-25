#!/usr/bin/env python3
"""見本の部品カタログ（mihon/parts/）の検品: 撮影・横スクロール・コンソールエラー・キーボード操作・スワイプ。

使い方: python3 tools/mihon_parts_check.py [撮影の保存先]
  既定の保存先: ~/dev/2026-09-23-freehp-photo-assets/parts-shots/
  リポジトリの直下をこのスクリプトの中で配信する（別のサーバーは要らない）。
結果は標準出力に JSON で出し、1つでも失敗があれば終了コード1。
"""
import functools
import http.server
import json
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "dev/2026-09-23-freehp-photo-assets/parts-shots"
WIDTHS = [320, 390, 768, 1440]
TONES = ["aoba", "genkido", "soramame"]
MAX_TABS = 400
# Google マップの iframe の中の警告は、部品の不具合ではないので分けて数える
THIRD_PARTY = ("google.com", "gstatic.com", "googleapis.com")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/mihon/parts/"


def watch_console(page, bucket):
    def on_console(msg):
        if msg.type != "error":
            return
        url = (msg.location or {}).get("url", "")
        key = "third_party" if any(d in url for d in THIRD_PARTY) else "own"
        bucket[key].append(f"{msg.text} @ {url}")
    page.on("console", on_console)
    page.on("pageerror", lambda err: bucket["own"].append(f"pageerror: {err}"))


def settle(page):
    page.wait_for_load_state("networkidle")
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(300)


UNSTICK_JS = """document.addEventListener('DOMContentLoaded', () => {
  const s = document.createElement('style');
  s.textContent = '.tonebar { position: static !important; }';
  document.head.append(s);
});"""

OVERFLOW_JS = """() => {
  const vw = document.documentElement.clientWidth;
  const wide = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width && r.right > vw + 0.5 && !el.closest('dialog:not([open])')) wide.push(el.className || el.tagName);
  });
  return { scroll: document.documentElement.scrollWidth, client: vw, wide: [...new Set(wide)].slice(0, 8) };
}"""


def tab_to(page, selector):
    for _ in range(MAX_TABS):
        page.keyboard.press("Tab")
        if page.evaluate("s => document.activeElement && document.activeElement.matches(s)", selector):
            return True
    return False


def keyboard_run(page, shots):
    """マウスを使わず、キーボードだけで全部品を操作する。"""
    r = {}
    page.evaluate("window.scrollTo(0, 0); document.activeElement && document.activeElement.blur()")

    r["gallery_focus"] = tab_to(page, ".fhp-gallery-item")
    page.keyboard.press("Enter")
    page.wait_for_timeout(400)
    r["gallery_open"] = page.evaluate("document.querySelector('.fhp-lightbox').open")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(400)
    r["gallery_next"] = page.inner_text(".fhp-lb-count")
    page.screenshot(path=str(shots / "kb-gallery-open-1440.png"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    r["gallery_closed"] = not page.evaluate("document.querySelector('.fhp-lightbox').open")
    r["gallery_focus_back"] = page.evaluate("document.activeElement.classList.contains('fhp-gallery-item')")

    r["contact_focus"] = tab_to(page, "#contact [data-channel]")
    r["map_focus"] = tab_to(page, ".fhp-map-now")
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)
    r["map_loaded"] = page.evaluate("!!document.querySelector('.fhp-map-frame iframe')")
    r["map_link_focus"] = tab_to(page, ".fhp-map-actions a")

    r["menu_focus"] = tab_to(page, '#menu [role="tab"][aria-selected="true"]')
    page.keyboard.press("ArrowRight")
    r["menu_tab2"] = page.evaluate("""() => document.activeElement.textContent.trim() + ' / panel visible: ' +
      !document.getElementById(document.activeElement.getAttribute('aria-controls')).hidden""")

    r["voice_focus"] = tab_to(page, ".fhp-voice-play")
    page.keyboard.press("Space")
    page.wait_for_timeout(700)
    r["voice_1_playing"] = page.evaluate("!document.querySelectorAll('.fhp-voice-track audio')[0].paused")
    page.locator("#voice .stage").screenshot(path=str(shots / "kb-voice-playing-1440.png"))
    tab_to(page, ".fhp-voice-seek")
    before = page.evaluate("document.activeElement.value")
    page.keyboard.press("ArrowRight")
    r["voice_seek_moved"] = page.evaluate("document.activeElement.value") != before
    tab_to(page, ".fhp-voice-track:nth-child(2) .fhp-voice-play")
    page.keyboard.press("Enter")
    page.wait_for_timeout(500)
    r["voice_only_one"] = page.evaluate("""() => {
      const a = [...document.querySelectorAll('.fhp-voice-track audio')];
      return a[0].paused && !a[1].paused;
    }""")
    page.keyboard.press("Enter")

    r["faq_focus"] = tab_to(page, ".fhp-faq-item summary")
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)
    r["faq_open"] = page.evaluate("document.querySelector('.fhp-faq-item').open")

    r["news_focus"] = tab_to(page, ".fhp-news-more")
    page.keyboard.press("Enter")
    r["news_all_shown"] = page.evaluate("[...document.querySelectorAll('.fhp-news-item')].every(li => !li.hidden)")

    r["hearing_focus"] = tab_to(page, 'input[name="work"]')
    page.keyboard.press("Space")
    tab_to(page, 'input[name="look"]')
    page.keyboard.press("Space")
    tab_to(page, 'input[name="contact"]')
    page.keyboard.press("Space")
    tab_to(page, 'input[name="update"]')
    page.keyboard.press("Space")
    tab_to(page, '.fhp-hear button[type="submit"]')
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)
    r["hearing_result"] = page.evaluate("!document.querySelector('.fhp-hear-result').hidden")
    r["hearing_picks"] = page.evaluate("[...document.querySelectorAll('.fhp-hear-pick-name')].map(e => e.textContent)")
    r["hearing_mail"] = page.get_attribute(".fhp-hear-mail", "href")[:60]
    return r


def swipe_run(browser, url, shots):
    """スマホの幅で、本物のタッチ操作（CDP）で左にスワイプして次の写真に送れるか。"""
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    page.goto(url)
    settle(page)
    page.locator(".fhp-gallery-item").first.tap()
    page.wait_for_timeout(400)
    cdp = ctx.new_cdp_session(page)
    y = 420

    def touch(kind, x):
        points = [] if kind == "touchEnd" else [{"x": x, "y": y}]
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})

    before = page.inner_text(".fhp-lb-count")
    touch("touchStart", 320)
    for x in (280, 220, 160, 100):
        touch("touchMove", x)
    touch("touchEnd", 100)
    page.wait_for_timeout(400)
    after = page.inner_text(".fhp-lb-count")
    page.screenshot(path=str(shots / "gallery-open-swiped-390.png"))
    ctx.close()
    return {"before": before, "after": after, "ok": before != after}


PARTS = ["gallery", "contact", "map", "menu", "voice", "faq", "news", "hearing"]
PUBLIC_URL = "https://freehp.jp/mihon/parts/"


def copy_run(browser, url, shots):
    """「コードをコピー」でクリップボードに入る中身と、「コードを見る」の表示。キーボードだけで押す。"""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=url.split("/mihon/")[0])
    ctx.add_init_script(UNSTICK_JS)
    page = ctx.new_page()
    page.goto(f"{url}?tone=genkido")
    settle(page)
    r = {"head": page.evaluate("""() => ({
      noindex: !!document.querySelector('meta[name=robots][content*=noindex]'),
      og: [...document.querySelectorAll('meta[property^="og:"]')].length,
      canonical: document.querySelector('link[rel=canonical]')?.href })""")}
    for name in PARTS:
        page.evaluate("document.activeElement && document.activeElement.blur()")
        page.focus(f'.copy-btn[data-copy="{name}"]')
        page.keyboard.press("Enter")
        page.wait_for_function(f"document.getElementById('{name}-copy-msg').textContent !== ''")
        text = page.evaluate("navigator.clipboard.readText()")
        r[name] = {
            "msg": page.inner_text(f"#{name}-copy-msg")[:12],
            "bytes": len(text.encode()),
            "has_style": "<style>" in text and "--fhp-bg" in text,
            "has_html": "class=\"fhp " in text,
            "has_js": "<script>" in text,
            "no_demo": "data-demo" not in text and "data-days-ago" not in text,
        }
    page.locator("#gallery .part-info").screenshot(path=str(shots / "copy-done-gallery-1440.png"))
    tab_to(page, '.part-code[data-code="gallery"] > summary')
    page.keyboard.press("Enter")
    page.wait_for_function("document.querySelector('.part-code[data-code=gallery]').dataset.loaded === 'true'")
    page.locator('.part-code[data-code="gallery"]').screenshot(path=str(shots / "code-open-gallery-1440.png"))
    r["code_viewer"] = page.evaluate("document.querySelector('.part-code[data-code=gallery] code').textContent.length")
    ctx.close()
    return r


def standalone_run(browser, url):
    """copy.html を、何もない白いページにそのまま貼っても動くか（写真と音声の URL は手元に向け替える）。"""
    base = url  # http://127.0.0.1:port/mihon/parts/
    out = {}
    for name in PARTS:
        bundle = (ROOT / "mihon/parts" / name / "copy.html").read_text(encoding="utf-8")
        html = "<!doctype html><html lang=ja><head><meta charset=utf-8><meta name=viewport content='width=device-width'></head><body>" \
            + bundle.replace(PUBLIC_URL, base) + "</body></html>"
        page = browser.new_page(viewport={"width": 390, "height": 844})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.route("**/standalone.html", lambda route: route.fulfill(content_type="text/html", body=html))
        page.goto(base + "standalone.html")
        settle(page)
        out[name] = {
            "errors": errors,
            "ready": page.evaluate("document.querySelectorAll('[data-fhp-ready]').length"),
            "overflow": page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"),
        }
        page.close()
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    httpd, url = serve()
    report = {"overflow": {}, "console": {"own": [], "third_party": []}}
    fail = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])

        # 1. 幅×トーンごとに横スクロールを測る。1440 と 390 はフルページで撮る
        for tone in TONES:
            for w in WIDTHS:
                ctx = browser.new_context(viewport={"width": w, "height": 900}, device_scale_factor=1 if w > 800 else 2)
                page = ctx.new_page()
                watch_console(page, report["console"])
                page.goto(f"{url}?tone={tone}")
                settle(page)
                # 遅延読み込みの画像と地図を出すため、いったん下まで送ってから戻る
                page.evaluate("async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise(r => setTimeout(r, 60)); } window.scrollTo({ top: 0, behavior: 'instant' }); }")
                settle(page)
                o = page.evaluate(OVERFLOW_JS)
                report["overflow"][f"{tone}-{w}"] = o
                if o["scroll"] > o["client"] or o["wide"]:
                    fail.append(f"overflow {tone}-{w}: {o}")
                if w in (1440, 390) and tone in ("aoba", "genkido") or (w == 1440 and tone == "soramame"):
                    page.screenshot(path=str(OUT / f"catalog-{tone}-{w}.png"), full_page=True)
                ctx.close()

        # 2. 操作した後の状態（1440 と 390）
        for w in (1440, 390):
            ctx = browser.new_context(viewport={"width": w, "height": 900 if w > 800 else 844}, device_scale_factor=1 if w > 800 else 2)
            # 部品ごとの撮影では、画面上に貼りつくトーンの切り替えが写り込まないようにする
            ctx.add_init_script(UNSTICK_JS)
            page = ctx.new_page()
            watch_console(page, report["console"])
            for tone in ("aoba", "genkido"):
                page.goto(f"{url}?tone={tone}&count=8")
                settle(page)
                page.locator(".fhp-gallery-item").nth(2).click()
                page.wait_for_timeout(500)
                page.screenshot(path=str(OUT / f"gallery-open-{tone}-{w}.png"))
                page.keyboard.press("Escape")
                for n in (3, 5, 12):
                    page.goto(f"{url}?tone={tone}&count={n}")
                    settle(page)
                    page.locator("#gallery .stage").screenshot(path=str(OUT / f"gallery-{n}-{tone}-{w}.png"))
                for label, now in (("open", "2026-09-24T12:00"), ("soon", "2026-09-24T18:40"),
                                   ("night", "2026-09-24T21:00"), ("holiday", "2026-09-23T12:00")):
                    page.goto(f"{url}?tone={tone}&now={now}")
                    settle(page)
                    page.locator("#contact .stage").screenshot(path=str(OUT / f"contact-{label}-{tone}-{w}.png"))
                page.goto(f"{url}?tone={tone}")
                settle(page)
                page.locator("#contact [data-channel]:not([hidden])").first.click()
                page.locator("#contact .stage").screenshot(path=str(OUT / f"contact-demo-click-{tone}-{w}.png"))
                page.locator("#map").scroll_into_view_if_needed()
                page.wait_for_timeout(2500)
                page.locator("#map .stage").screenshot(path=str(OUT / f"map-{tone}-{w}.png"))
                for fmt in ("photo", "text"):
                    page.goto(f"{url}?tone={tone}&menu={fmt}")
                    settle(page)
                    page.locator("#menu .stage").screenshot(path=str(OUT / f"menu-{fmt}-{tone}-{w}.png"))
                page.locator("#fhp-menu-tab-food").click()
                page.locator("#menu .stage").screenshot(path=str(OUT / f"menu-tab2-{tone}-{w}.png"))
                page.locator(".fhp-voice-play").nth(1).click()
                page.wait_for_timeout(1500)
                page.locator("#voice .stage").screenshot(path=str(OUT / f"voice-playing-{tone}-{w}.png"))
                page.locator(".fhp-voice-play").nth(1).click()
                page.locator(".fhp-faq-item summary").nth(1).click()
                page.wait_for_timeout(400)
                page.locator("#faq .stage").screenshot(path=str(OUT / f"faq-open-{tone}-{w}.png"))
                page.locator(".fhp-news-more").click()
                page.locator("#news .stage").screenshot(path=str(OUT / f"news-expanded-{tone}-{w}.png"))
                page.locator('.fhp-hear button[type="submit"]').click()
                page.locator("#hearing .stage").screenshot(path=str(OUT / f"hearing-error-{tone}-{w}.png"))
                for sel in ('input[name="work"][value="food"]', 'input[name="look"][value="photos"]',
                            'input[name="look"][value="place"]', 'input[name="contact"][value="tel"]',
                            'input[name="update"][value="often"]'):
                    page.locator(sel).check()
                page.locator('.fhp-hear button[type="submit"]').click()
                page.wait_for_timeout(300)
                page.locator("#hearing .stage").screenshot(path=str(OUT / f"hearing-result-{tone}-{w}.png"))
            ctx.close()

        # 3. キーボードだけで全部品
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        watch_console(page, report["console"])
        page.goto(f"{url}?tone=aoba")
        settle(page)
        report["keyboard"] = keyboard_run(page, OUT)
        ctx.close()

        # 4. スワイプ
        report["swipe"] = swipe_run(browser, f"{url}?tone=aoba", OUT)
        # 5. コードのコピーと表示、貼っただけで動くか
        report["copy"] = copy_run(browser, url, OUT)
        report["standalone"] = standalone_run(browser, url)
        browser.close()
    httpd.shutdown()

    cp = report["copy"]
    if cp["head"]["noindex"] or cp["head"]["og"] < 6:
        fail.append(f"head {cp['head']}")
    for name in PARTS:
        c = cp[name]
        if not (c["msg"].startswith("コピーしました") and c["has_style"] and c["has_html"] and c["no_demo"]
                and (c["has_js"] or name == "faq")):
            fail.append(f"copy {name} {c}")
        st = report["standalone"][name]
        if st["errors"] or (name != "faq" and st["ready"] < 1) or st["overflow"] > 0:
            fail.append(f"standalone {name} {st}")
    kb = report["keyboard"]
    for k, v in kb.items():
        if v is False:
            fail.append(f"keyboard {k}")
    if kb.get("gallery_next") != "2 / 8":
        fail.append(f"keyboard gallery_next={kb.get('gallery_next')}")
    if not report["swipe"]["ok"]:
        fail.append(f"swipe {report['swipe']}")
    if report["console"]["own"]:
        fail.append("console errors")
    report["fail"] = fail
    print(json.dumps(report, ensure_ascii=False, indent=1))
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
