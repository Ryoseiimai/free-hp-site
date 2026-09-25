#!/usr/bin/env python3
"""見本の部品カタログ（mihon/parts/）で使う写真の切り出しと、音声プレーヤー用の合成音を作る。

写真: ~/dev/2026-09-23-freehp-photo-assets/originals の5枚（見本5件と同じAI作成の写真）から、
      全体と部分の切り出しを作る（ギャラリーで12枚まで試すため）。
      ミニけしの写真は袋に架空の社名が大きく写っているので使わない。
音声: 声の代わりに数秒の合成音を作る（mp3）。波形の棒グラフ用に音量の山も書き出す。

OGP: カタログの共有用画像（1200x630）を、切り出した写真と文字から作る（playwright で描画）。

使い方: python3 tools/mihon_parts_assets.py [--ogp-only]
"""
import json
import math
import random
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

from PIL import Image

ORIGINALS = Path.home() / "dev/2026-09-23-freehp-photo-assets/originals"
OUT = Path(__file__).resolve().parent.parent / "mihon/parts"
IMG_OUT = OUT / "img"
AUDIO_OUT = OUT / "voice"

LARGE_EDGE = 1280
THUMB_EDGE = 640
JPEG_QUALITY = 80

# (出力名, 元画像, 切り出し範囲 左上x,y 右下x,y の比率)
CROPS = [
    ("soda", "03_cream_soda.png", (0.0, 0.0, 1.0, 1.0)),
    ("soda-ice", "03_cream_soda.png", (0.44, 0.26, 0.88, 0.55)),
    ("soda-lamp", "03_cream_soda.png", (0.58, 0.0, 1.0, 0.3)),
    ("soda-spoon", "03_cream_soda.png", (0.22, 0.7, 0.92, 1.0)),
    ("beans", "02_coffee_beans.png", (0.0, 0.0, 1.0, 1.0)),
    ("beans-label", "02_coffee_beans.png", (0.42, 0.1, 0.74, 0.6)),
    ("beans-pile", "02_coffee_beans.png", (0.14, 0.62, 0.56, 0.98)),
    ("room", "05_seitai_room.png", (0.0, 0.0, 1.0, 1.0)),
    ("room-towel", "05_seitai_room.png", (0.24, 0.56, 0.58, 0.84)),
    ("room-window", "05_seitai_room.png", (0.1, 0.0, 0.5, 0.42)),
    ("salon", "04_salon_tools.png", (0.0, 0.0, 1.0, 1.0)),
    ("salon-scissors", "04_salon_tools.png", (0.18, 0.28, 0.78, 0.78)),
]

SAMPLE_RATE = 22050
PEAK_BARS = 56


def fit(img, edge):
    w, h = img.size
    scale = min(1.0, edge / max(w, h))
    if scale == 1.0:
        return img
    return img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)


def make_images():
    IMG_OUT.mkdir(parents=True, exist_ok=True)
    sizes = {}
    for name, src, (x0, y0, x1, y1) in CROPS:
        img = Image.open(ORIGINALS / src).convert("RGB")
        w, h = img.size
        crop = img.crop((round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)))
        large = fit(crop, LARGE_EDGE)
        thumb = fit(crop, THUMB_EDGE)
        large.save(IMG_OUT / f"{name}-l.jpg", quality=JPEG_QUALITY, optimize=True, progressive=True)
        thumb.save(IMG_OUT / f"{name}-s.jpg", quality=JPEG_QUALITY, optimize=True, progressive=True)
        sizes[name] = {"l": large.size, "s": thumb.size}
    print(json.dumps(sizes))


def envelope(i, n, attack, release):
    t = i / SAMPLE_RATE
    left = (n - i) / SAMPLE_RATE
    return min(1.0, t / attack, left / release)


def tone(freq, seconds, volume=0.35):
    n = int(seconds * SAMPLE_RATE)
    # 鐘のように、鳴らした直後が大きく、だんだん減衰する
    return [
        volume * envelope(i, n, 0.02, min(0.6, seconds * 0.6)) * math.exp(-2.2 * i / SAMPLE_RATE)
        * (math.sin(2 * math.pi * freq * i / SAMPLE_RATE)
           + 0.3 * math.sin(4 * math.pi * freq * i / SAMPLE_RATE))
        for i in range(n)
    ]


def melody(notes):
    out = []
    for freq, seconds in notes:
        out += tone(freq, seconds) if freq else [0.0] * int(seconds * SAMPLE_RATE)
    return out


def soft_noise(seconds):
    """雨音のような、柔らかく揺れるノイズ。"""
    rng = random.Random(7)
    n = int(seconds * SAMPLE_RATE)
    out, last = [], 0.0
    for i in range(n):
        last = 0.96 * last + 0.04 * rng.uniform(-1, 1)
        swell = 0.55 + 0.45 * math.sin(2 * math.pi * 0.35 * i / SAMPLE_RATE)
        out.append(2.4 * last * swell * envelope(i, n, 0.8, 1.2))
    return out


C4, D4, E4, G4, A4, C5 = 261.63, 293.66, 329.63, 392.0, 440.0, 523.25
CLIPS = {
    "intro": melody([(C5, .5), (G4, .5), (E4, .5), (G4, 1.6)]),
    "scene": soft_noise(6.0),
    "song": melody([(E4, .4), (G4, .4), (A4, .8), (G4, .4), (E4, .4), (D4, .8),
                    (C4, .4), (D4, .4), (E4, .4), (G4, .4), (E4, 1.6)]),
}


def peaks(samples):
    size = max(1, len(samples) // PEAK_BARS)
    chunks = [samples[i:i + size] for i in range(0, size * PEAK_BARS, size)]
    raw = [math.sqrt(sum(s * s for s in c) / len(c)) for c in chunks]
    top = max(raw) or 1.0
    return [round(v / top, 2) for v in raw]


def make_audio():
    AUDIO_OUT.mkdir(parents=True, exist_ok=True)
    table = {}
    for name, samples in CLIPS.items():
        with tempfile.TemporaryDirectory() as tmp:
            wav_path = Path(tmp) / f"{name}.wav"
            with wave.open(str(wav_path), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(SAMPLE_RATE)
                w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples))
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path),
                 "-codec:a", "libmp3lame", "-b:a", "64k", str(AUDIO_OUT / f"{name}.mp3")],
                check=True,
            )
        table[name] = {"seconds": round(len(samples) / SAMPLE_RATE, 1), "peaks": peaks(samples)}
    print(json.dumps(table))


OGP_HTML = """<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700;900&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1200px; height: 630px; display: grid; grid-template-columns: 600px 600px;
         background: #FFFFFF; color: #1E2A44; font-family: "Zen Kaku Gothic New", sans-serif; font-feature-settings: "palt" 1; }
  .text { display: flex; flex-direction: column; justify-content: center; padding: 0 56px 0 72px; }
  .by { margin: 0; font-size: 26px; font-weight: 700; color: #5A6275; }
  h1 { margin: 18px 0 0; font-size: 66px; white-space: nowrap; font-weight: 900; line-height: 1.18; letter-spacing: .01em; }
  .sub { margin: 28px 0 0; font-size: 28px; white-space: nowrap; font-weight: 700; line-height: 1.5; }
  .photos { display: grid; grid-template-columns: 276px 276px; grid-template-rows: 271px 271px; gap: 8px; padding: 40px 40px 40px 0; }
  .photos img { width: 100%; height: 100%; min-height: 0; object-fit: cover; display: block; }
</style></head><body>
<div class="text"><p class="by">AIホームページ製作所</p><h1>ホームページに<br>貼れる部品</h1>
<p class="sub">8種類。コピーして貼るだけ。<br>無料で、商用にも使えます。</p></div>
<div class="photos"><img src="soda-s.jpg"><img src="beans-label-s.jpg"><img src="room-s.jpg"><img src="salon-scissors-s.jpg"></div>
</body></html>"""


def make_ogp():
    from playwright.sync_api import sync_playwright

    page_path = IMG_OUT / "_ogp.html"
    page_path.write_text(OGP_HTML, encoding="utf-8")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1200, "height": 630})
            page.goto(page_path.as_uri())
            page.wait_for_load_state("networkidle")
            page.evaluate("document.fonts.ready")
            page.screenshot(path=str(OUT / "ogp.png"))
            browser.close()
    finally:
        page_path.unlink()
    print("ogp.png")


if __name__ == "__main__":
    import sys

    if "--ogp-only" not in sys.argv:
        make_images()
        make_audio()
    make_ogp()
