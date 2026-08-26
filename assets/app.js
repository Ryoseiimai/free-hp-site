(() => {
  "use strict";

  const API_BASE = "https://free-hp-engine.ryoseiworld.workers.dev";
  const API_URL = `${API_BASE}/api/generate`;
  const EXPECTED_WORKER_ORIGIN = API_BASE;
  const EXPIRY_CONTACT_EMAIL = "info@ryoseiworld.co.jp";
  const EXPIRY_CONTACT_SUBJECT = "正式版への引っ越し希望";

  // 写真の縮小仕様（サーバの上限2,000,000文字に合わせて余裕を持たせる）
  const PHOTO_MAX_DIMENSION = 1400;
  const PHOTO_FALLBACK_DIMENSION = 1000;
  const PHOTO_SOFT_LIMIT_CHARS = 900000;
  const PHOTO_HARD_LIMIT_CHARS = 2000000;
  const PHOTO_QUALITY_STEPS = [0.8, 0.65, 0.5];
  const JAPANESE_TEXT_PATTERN = /[぀-ヿ㐀-鿿]/u;

  const form = document.querySelector("#site-form");
  if (!form) return;

  const preview = document.querySelector("#sample-site");
  const previewValues = {
    shopName: preview.querySelector('[data-preview="shopName"]'),
    businessType: preview.querySelector('[data-preview="businessType"]'),
    catchcopy: preview.querySelector('[data-preview="catchcopy"]'),
    description: preview.querySelector('[data-preview="description"]'),
    phone: preview.querySelector('[data-preview="phone"]'),
    address: preview.querySelector('[data-preview="address"]'),
    hours: preview.querySelector('[data-preview="hours"]')
  };
  const MENU_PREVIEW_MAX_ITEMS = 3;
  // 価格として認めるのは「数字」「数字+円」「¥+数字」だけ（サーバ側の判定と揃えている）。
  const MENU_PRICE_PATTERN = /^(?:[0-9]+(?:円)?|¥[0-9]+)$/u;
  const menuPreviewWrap = document.querySelector("#sample-menu-preview");
  const menuPreviewList = preview.querySelector('[data-preview="menuText"]');

  const sampleActions = document.querySelector("#sample-actions");
  const previewActionChips = {
    reserve: preview.querySelector('[data-preview-action="reserve"]'),
    instagram: preview.querySelector('[data-preview-action="instagram"]'),
    line: preview.querySelector('[data-preview-action="line"]')
  };
  const typeBlocks = {
    "飲食店": preview.querySelector('[data-type-block="restaurant"]'),
    "美容・サロン": preview.querySelector('[data-type-block="beauty"]'),
    "教室・スクール": preview.querySelector('[data-type-block="school"]'),
    "小売・物販": preview.querySelector('[data-type-block="retail"]'),
    "修理・住まいのサービス": preview.querySelector('[data-type-block="home-service"]'),
    "士業・専門サービス": preview.querySelector('[data-type-block="office"]'),
    "不動産・建設": preview.querySelector('[data-type-block="company"]'),
    "医療・クリニック": preview.querySelector('[data-type-block="clinic"]'),
    "その他": preview.querySelector('[data-type-block="other"]')
  };
  const moodColors = {
    "あたたかい": "var(--preview-warm)",
    "落ち着いた": "var(--preview-calm)",
    "さわやか": "var(--preview-fresh)",
    "たのしい": "var(--preview-fun)",
    "しっとり": "var(--preview-moody)"
  };

  const applyButton = document.querySelector("#apply-button");
  const generationResult = document.querySelector("#generation-result");
  const generationLoading = document.querySelector("#generation-loading");
  const generationSuccess = document.querySelector("#generation-success");
  const generationError = document.querySelector("#generation-error");
  const generationStatus = document.querySelector("#generation-status");
  const errorMessage = document.querySelector("#generation-error-message");
  const generatedLink = document.querySelector("#generated-link");
  const generatedPreview = document.querySelector("#generated-preview");
  const copyGeneratedLinkButton = document.querySelector("#copy-generated-link");
  const generatedCopyStatus = document.querySelector("#generated-copy-status");
  const manualContactLink = document.querySelector("#manual-contact-link");
  const expiryContactLink = document.querySelector("#expiry-contact-link");

  // ---------- ztconsole: 生成中のライブ演出（見た目のみ・実データは持たない） ----------
  // 意図的な簡略化: 本物のエージェント実行ログではなく、工程順（読み込み→構成→文章→組み立て→検証→配信）に
  // 並べたダミー文言と、時間で伸びる横向きレーンを描くだけ。本格的に実処理と連動させるなら
  // ztPushLog / ztTickLanes をサーバの生成進捗イベント（SSE/WebSocket等）から駆動する形に差し替える。
  const ztconsole = document.querySelector("#ztconsole");
  const ztLanesEl = document.querySelector("#ztconsole-lanes");
  const ztLogEl = document.querySelector("#ztconsole-log");
  const ztWaveGlyphsEl = document.querySelector("#ztconsole-wave-glyphs");
  const ztWaveBarsEl = document.querySelector("#ztconsole-wave-bars");
  const ztClockEl = document.querySelector("#ztconsole-clock");
  const ztCountEl = document.querySelector("#ztconsole-count");
  const ztPhaseEl = document.querySelector("#ztconsole-phase");

  const ZT_MOBILE_MAX_WIDTH = 560;
  const ZT_TICK_MS = 100;            // レーン・時計の更新間隔
  const ZT_WAVE_MS = 170;            // 波形が1コマ左へ流れる間隔
  const ZT_REDUCED_MOTION_SLOWDOWN = 4; // reduced-motion時は更新頻度を落とす
  const ZT_LANE_SPEED_PX = 3;        // 1tickでタイムラインが進むpx（=30px/秒）
  const ZT_LANE_RIGHT_PAD_PX = 28;   // 進行中バーの先頭と右端の余白
  const ZT_LANE_PRUNE_PX = 40;       // 左へ流れ切ったバーを捨てる余裕
  const ZT_MARK_CHANCE = 0.14;       // 1tickでツール呼び出しマーカーが打たれる確率
  const ZT_MARK_MIN_SPACING_PX = 9;  // マーカー同士の最小間隔
  const ZT_LOG_MAX_LINES = 6;
  const ZT_WAVE_GLYPHS = ["×", "◆", "*", "※", "+", "·"];
  const ZT_WAVE_GLYPH_CHANCE = 0.3;
  const ZT_WAVE_HOT = 72;            // 波形バーを緑にする高さ(%)
  const ZT_WAVE_WARM = 48;           // 波形バーを黄土にする高さ(%)
  const ZT_PREFERS_REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // レーン定義（x=タイムライン上のpx）。main は最初から、sub は少し遅れて起動し「agentが増えていく」感を出す
  const ZT_LANES = [
    { label: "main", startX: 0, dur: [60, 170], gap: [6, 18] },
    { label: "sub·1", startX: 45, dur: [30, 120], gap: [10, 48] },
    { label: "sub·2", startX: 120, dur: [24, 90], gap: [16, 70] }
  ];

  // 工程（phase）。ランダムに選ぶのは同じ工程内だけ（前後2件の窓から選ぶので順序感が残る）。
  // kind: ok=● / write=◆ / fail=×。fail の直後は必ず次の行（リトライ成功）を出す。
  const ZT_PHASES = [
    { name: "reading", logMs: 520, lines: [
      ["ok", "Read", "shop-name → 入力内容"],
      ["ok", "Read", "業種 → テンプレートを選択"],
      ["ok", "Read", "写真 → sample-hero.jpg"],
      ["ok", "Grep", "電話番号 / 住所 / 営業時間"]
    ] },
    { name: "composing", logMs: 620, lines: [
      ["ok", "Plan", "セクション構成 hero / menu / access"],
      ["ok", "Think", "catchcopy 候補を3案 生成"],
      ["write", "Edit", "mood palette → 色の雰囲気を反映"],
      ["ok", "Think", "メニュー・料金を整形"],
      ["write", "Write", "copy/hero.md"]
    ] },
    { name: "building", logMs: 700, lines: [
      ["write", "Write", "hero-section.html"],
      ["write", "Write", "menu-section.html"],
      ["ok", "Bash", "convert photo → webp (q=82)"],
      ["fail", "Bash failed", "fetch fonts · retry (1/2)"],
      ["ok", "Bash", "fetch fonts ✓"],
      ["write", "Edit", "footer links を配置"],
      ["ok", "Bash", "npm run build"]
    ] },
    { name: "verifying", logMs: 800, lines: [
      ["ok", "Check", "HTML structure valid"],
      ["ok", "Check", "mobile layout 375px"],
      ["ok", "Check", "tel: リンク / 地図リンク"],
      ["ok", "Check", "contrast / a11y"]
    ] },
    { name: "deploying", logMs: 1000, lines: [
      ["write", "Write", "generated/site.html"],
      ["ok", "Deploy", "→ workers.dev"],
      ["ok", "Wait", "edge cache warming…"],
      ["ok", "Deploy", "見本URLを発行中"]
    ], loop: [ // 生成が長引いたときに繰り返す（連続重複はしない）
      ["ok", "Wait", "edge cache warming…"],
      ["ok", "Poll", "deploy status"],
      ["ok", "Check", "DNS propagation"],
      ["ok", "Wait", "見本URLの応答を確認中"]
    ] }
  ];
  const ZT_LOG_WINDOW = 2; // 同工程内で「次の候補」として見る行数

  const ztState = {
    running: false,
    timers: [],
    logTimer: 0,
    x: 0,
    tools: 0,
    agents: 1,
    lanes: [],
    wave: [],
    glyphs: [],
    phaseIndex: 0,
    pending: [],
    forcedNext: null,
    lastLogText: ""
  };

  const ztIsMobile = () => window.innerWidth <= ZT_MOBILE_MAX_WIDTH;
  const ztWaveCount = () => (ztIsMobile() ? 30 : 52);
  const ztRand = ([min, max]) => min + Math.round(Math.random() * (max - min));
  const ztPad2 = (n) => String(n).padStart(2, "0");
  const ztClockText = (now) =>
    `${now.getFullYear()}-${ztPad2(now.getMonth() + 1)}-${ztPad2(now.getDate())} ${ztPad2(now.getHours())}:${ztPad2(now.getMinutes())}:${ztPad2(now.getSeconds())}`;

  const ztUpdateCount = () => {
    if (!ztCountEl) return;
    ztCountEl.textContent = `${ztState.agents} agent${ztState.agents === 1 ? "" : "s"} · ${ztState.tools} tools`;
  };

  // ---- レーン ----
  const ztBuildLanes = () => {
    if (!ztLanesEl) return;
    ztLanesEl.textContent = "";
    ztState.lanes = ZT_LANES.map((cfg, index) => {
      const lane = document.createElement("div");
      lane.className = `ztconsole-lane ${index === 0 ? "is-main" : "is-idle"}`;
      const label = document.createElement("span");
      label.className = "ztconsole-lane-label";
      label.textContent = cfg.label;
      const track = document.createElement("div");
      track.className = "ztconsole-lane-track";
      const strip = document.createElement("div");
      strip.className = "ztconsole-lane-strip";
      track.appendChild(strip);
      lane.append(label, track);
      ztLanesEl.appendChild(lane);
      return { cfg, el: lane, track, strip, bars: [], active: null, nextStartX: cfg.startX };
    });
  };

  const ztCreateBar = (lane, x) => {
    const el = document.createElement("span");
    el.className = "ztconsole-lane-bar is-active";
    el.style.left = `${x}px`;
    el.style.width = "0px";
    lane.strip.appendChild(el);
    const bar = { el, startX: x, endX: x + ztRand(lane.cfg.dur), width: 0, lastMarkAt: -ZT_MARK_MIN_SPACING_PX };
    lane.bars.push(bar);
    if (lane !== ztState.lanes[0]) ztState.agents += 1; // subのバー1本＝子agent1体
    return bar;
  };

  const ztAddMark = (bar, atX) => {
    if (atX - bar.lastMarkAt < ZT_MARK_MIN_SPACING_PX) return;
    const mark = document.createElement("i");
    mark.className = "ztconsole-lane-mark";
    mark.style.left = `${atX}px`;
    bar.el.appendChild(mark);
    bar.lastMarkAt = atX;
    ztState.tools += 1;
  };

  const ztTickLanes = () => {
    if (!ztState.lanes.length) return;
    ztState.x += ZT_LANE_SPEED_PX;
    const x = ztState.x;
    const trackWidth = ztState.lanes[0].track.clientWidth;
    const offset = Math.max(0, x - trackWidth + ZT_LANE_RIGHT_PAD_PX);
    ztState.lanes.forEach((lane) => {
      if (x < lane.cfg.startX) return;
      lane.el.classList.remove("is-idle");
      if (lane.active) {
        const bar = lane.active;
        bar.width = x - bar.startX;
        bar.el.style.width = `${bar.width}px`;
        if (Math.random() < ZT_MARK_CHANCE) ztAddMark(bar, bar.width);
        if (x >= bar.endX) {
          bar.el.classList.remove("is-active");
          lane.active = null;
          lane.nextStartX = x + ztRand(lane.cfg.gap);
        }
      } else if (x >= lane.nextStartX) {
        lane.active = ztCreateBar(lane, x);
      }
      lane.strip.style.transform = `translateX(${-offset}px)`;
      // 左へ流れ切ったバーは捨てる（実データではないので保持不要）
      while (lane.bars.length && lane.bars[0].startX + lane.bars[0].width < offset - ZT_LANE_PRUNE_PX) {
        lane.bars.shift().el.remove();
      }
    });
    ztUpdateCount();
    if (ztClockEl) ztClockEl.textContent = ztClockText(new Date());
  };

  // ---- 波形 ----
  const ztBuildWave = () => {
    if (!ztWaveBarsEl || !ztWaveGlyphsEl) return;
    ztWaveBarsEl.textContent = "";
    ztWaveGlyphsEl.textContent = "";
    ztState.wave = [];
    ztState.glyphs = [];
    const count = ztWaveCount();
    for (let i = 0; i < count; i += 1) {
      const bar = document.createElement("span");
      bar.className = "ztconsole-wave-bar";
      ztWaveBarsEl.appendChild(bar);
      const glyph = document.createElement("span");
      ztWaveGlyphsEl.appendChild(glyph);
      ztState.wave.push({ el: bar, height: 10 + Math.round(Math.random() * 60) });
      ztState.glyphs.push({ el: glyph, text: "" });
    }
  };

  const ztNextWaveHeight = (prev) => {
    const spike = Math.random() < 0.12 ? 40 : 0;
    const next = prev * 0.45 + (8 + Math.random() * 62) * 0.55 + spike;
    return Math.max(6, Math.min(100, Math.round(next)));
  };

  const ztNextGlyph = () => {
    if (Math.random() > ZT_WAVE_GLYPH_CHANCE) return "";
    return ZT_WAVE_GLYPHS[Math.floor(Math.random() * ZT_WAVE_GLYPHS.length)];
  };

  const ztTickWave = () => {
    const { wave, glyphs } = ztState;
    if (!wave.length) return;
    // 右端に新しいコマを足し、全体を1コマ左へ流す（心電図的な動き）
    const heights = wave.map((w) => w.height);
    heights.shift();
    heights.push(ztNextWaveHeight(heights[heights.length - 1]));
    const texts = glyphs.map((g) => g.text);
    texts.shift();
    texts.push(ztNextGlyph());
    wave.forEach((w, i) => {
      w.height = heights[i];
      w.el.style.height = `${w.height}%`;
      w.el.classList.toggle("is-hot", w.height >= ZT_WAVE_HOT);
      w.el.classList.toggle("is-warm", w.height >= ZT_WAVE_WARM && w.height < ZT_WAVE_HOT);
    });
    glyphs.forEach((g, i) => {
      g.text = texts[i];
      g.el.textContent = g.text;
      g.el.className = g.text === "×" ? "is-fail" : g.text === "◆" ? "is-warn" : g.text === "*" || g.text === "※" ? "is-hot" : "";
    });
  };

  // ---- ログ（工程順） ----
  const ztCurrentPhase = () => ZT_PHASES[Math.min(ztState.phaseIndex, ZT_PHASES.length - 1)];

  const ztLoadPhase = (index) => {
    ztState.phaseIndex = index;
    // fail 行は直後の行（リトライ成功）を抱き合わせにして、順序が入れ替わらないようにする
    const pending = [];
    const lines = ztCurrentPhase().lines;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const then = line[0] === "fail" && i + 1 < lines.length ? lines[i + 1] : null;
      pending.push({ line, then });
      if (then) i += 1;
    }
    ztState.pending = pending;
    if (ztPhaseEl) ztPhaseEl.textContent = ztCurrentPhase().name;
  };

  const ztPickLine = () => {
    if (ztState.forcedNext) {
      const forced = ztState.forcedNext;
      ztState.forcedNext = null;
      return forced;
    }
    if (!ztState.pending.length) {
      if (ztState.phaseIndex < ZT_PHASES.length - 1) {
        ztLoadPhase(ztState.phaseIndex + 1);
      } else {
        // 最終工程を使い切ったら loop 文言を回す（直前と同じ文言は避ける）
        const loop = ztCurrentPhase().loop.filter((line) => line[2] !== ztState.lastLogText);
        return loop[Math.floor(Math.random() * loop.length)];
      }
    }
    const windowSize = Math.min(ZT_LOG_WINDOW, ztState.pending.length);
    const pick = Math.floor(Math.random() * windowSize);
    const entry = ztState.pending.splice(pick, 1)[0];
    if (entry.then) ztState.forcedNext = entry.then; // リトライ成功行を必ず直後に出す
    return entry.line;
  };

  const ztPushLog = () => {
    if (!ztLogEl) return;
    const [kind, cmd, text] = ztPickLine();
    ztState.lastLogText = text;
    const line = document.createElement("p");
    line.className = `ztconsole-log-line${kind === "fail" ? " is-fail" : ""}`;
    const timeSpan = document.createElement("span");
    timeSpan.className = "ztconsole-log-time";
    const now = new Date();
    timeSpan.textContent = `${ztPad2(now.getHours())}:${ztPad2(now.getMinutes())}:${ztPad2(now.getSeconds())}`;
    const markSpan = document.createElement("span");
    markSpan.className = `ztconsole-log-mark is-${kind}`;
    markSpan.textContent = kind === "fail" ? "×" : kind === "write" ? "◆" : "●";
    const cmdSpan = document.createElement("span");
    cmdSpan.className = "ztconsole-log-cmd";
    cmdSpan.textContent = `${cmd} · `;
    const textSpan = document.createElement("span");
    textSpan.className = "ztconsole-log-text";
    textSpan.textContent = text;
    line.append(timeSpan, markSpan, cmdSpan, textSpan);
    ztLogEl.appendChild(line);
    while (ztLogEl.childElementCount > ZT_LOG_MAX_LINES) ztLogEl.removeChild(ztLogEl.firstChild);
    ztState.tools += 1;
  };

  const ztScheduleLog = () => {
    if (!ztState.running) return;
    ztPushLog();
    const slow = ZT_PREFERS_REDUCED_MOTION ? ZT_REDUCED_MOTION_SLOWDOWN : 1;
    ztState.logTimer = setTimeout(ztScheduleLog, ztCurrentPhase().logMs * slow);
  };

  const ztStart = () => {
    if (!ztconsole || ztState.running) return;
    ztState.running = true;
    ztState.x = 0;
    ztState.tools = 0;
    ztState.agents = 1;
    ztState.forcedNext = null;
    ztState.lastLogText = "";
    if (ztLogEl) ztLogEl.textContent = "";
    ztBuildLanes();
    ztBuildWave();
    ztLoadPhase(0);
    ztTickLanes();
    ztTickWave();
    ztScheduleLog();
    const slow = ZT_PREFERS_REDUCED_MOTION ? ZT_REDUCED_MOTION_SLOWDOWN : 1;
    ztState.timers.push(setInterval(ztTickLanes, ZT_TICK_MS * slow));
    ztState.timers.push(setInterval(ztTickWave, ZT_WAVE_MS * slow));
  };

  const ztStop = () => {
    ztState.timers.forEach((id) => clearInterval(id));
    ztState.timers = [];
    clearTimeout(ztState.logTimer);
    ztState.logTimer = 0;
    ztState.running = false;
  };

  // クライアントIDが空のあいだはログイン欄を出さず、従来どおり作成できる。
  const googleClientId = (document.querySelector('meta[name="google-client-id"]') || {}).content || "";
  const signinArea = document.querySelector("#signin-area");
  const signinButton = document.querySelector("#google-signin-button");
  const signinStatus = document.querySelector("#signin-status");
  const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
  let idToken = "";

  const photoInput = document.querySelector("#photo");
  const photoStatus = document.querySelector("#photo-status");
  const photoName = document.querySelector("#photo-name");
  const PHOTO_NAME_EMPTY = "まだ選ばれていません";
  const photoPreview = preview.querySelector('[data-preview="photo"]');
  const photoStatusDefault = photoStatus.textContent;

  let photoDataUri = "";
  let photoGeneration = 0;
  let photoProcessing = Promise.resolve();

  const getValue = (name) => {
    const field = form.elements[name];
    if (!field) return "";
    if (field instanceof RadioNodeList) return field.value;
    return field.value.trim();
  };

  const displayValue = (value, fallback) => value || fallback;

  const suggestedCatchphrase = () => {
    const custom = getValue("catchcopy");
    if (custom) return custom;
    const description = getValue("description");
    if (description) {
      const firstPhrase = description.split(/[。！？!?\n]/u)[0].trim();
      if (firstPhrase) return firstPhrase.slice(0, 60);
    }
    return "ここに、あなたの物語を。";
  };

  // 1行を「品名｜価格」または「品名 価格」として読む（サーバ側の解釈を、見本用に簡略化したもの）。
  const parseMenuLineForPreview = (line) => {
    const value = line.trim();
    const separatorAt = value.indexOf("｜");
    if (separatorAt >= 0) {
      const name = value.slice(0, separatorAt).trim();
      const price = value.slice(separatorAt + 1).trim();
      if (name && MENU_PRICE_PATTERN.test(price)) return { name, price };
      return { name: value, price: "" };
    }
    const spaced = /^(.*?)\s+(\S+)$/u.exec(value);
    if (spaced) {
      const name = spaced[1].trim();
      const price = spaced[2];
      if (name && MENU_PRICE_PATTERN.test(price)) return { name, price };
    }
    return { name: value, price: "" };
  };

  const updateMenuPreview = (menuText) => {
    const lines = menuText
      ? menuText.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).slice(0, MENU_PREVIEW_MAX_ITEMS)
      : [];
    menuPreviewList.textContent = "";
    lines.forEach((line) => {
      const item = parseMenuLineForPreview(line);
      const listItem = document.createElement("li");
      listItem.className = "sample-menu-item";
      const nameSpan = document.createElement("span");
      nameSpan.className = "sample-menu-item-name";
      nameSpan.textContent = item.name;
      listItem.appendChild(nameSpan);
      if (item.price) {
        const priceSpan = document.createElement("span");
        priceSpan.className = "sample-menu-item-price";
        priceSpan.textContent = item.price;
        listItem.appendChild(priceSpan);
      }
      menuPreviewList.appendChild(listItem);
    });
    menuPreviewWrap.hidden = lines.length === 0;
  };

  const updatePreview = () => {
    const name = getValue("shopName");
    const type = getValue("businessType") || "飲食店";
    const catchcopy = suggestedCatchphrase();
    const description = getValue("description");
    const mood = getValue("mood") || "あたたかい";
    const phone = getValue("phone");
    const address = getValue("address");
    const hours = getValue("hours");
    const reserveUrl = getValue("reserveUrl");
    const instagram = getValue("instagram");
    const lineOfficial = getValue("lineOfficial");
    const menuText = getValue("menuText");

    previewValues.shopName.textContent = displayValue(name, "あなたのお店");
    previewValues.businessType.textContent = type;
    previewValues.catchcopy.textContent = catchcopy;
    previewValues.description.textContent = displayValue(description, "お店の特徴を入れると、ここにすぐ反映されます。");
    previewValues.phone.textContent = displayValue(phone, "電話番号はここに表示されます");
    previewValues.address.textContent = displayValue(address, "住所はここに表示されます");
    previewValues.hours.textContent = displayValue(hours, "営業時間はここに表示されます");
    preview.style.setProperty("--preview-accent", moodColors[mood] || moodColors["あたたかい"]);

    Object.entries(typeBlocks).forEach(([label, block]) => {
      block.hidden = label !== type;
    });

    // 行動ボタンの気配だけをプレビューに反映する（実際のhref組み立て・検証はサーバ側で行う）。
    previewActionChips.reserve.hidden = !reserveUrl;
    previewActionChips.instagram.hidden = !instagram;
    previewActionChips.line.hidden = !lineOfficial;
    sampleActions.hidden = !(reserveUrl || instagram || lineOfficial);

    updateMenuPreview(menuText);
  };

  const estimateKbFromDataUri = (dataUri) => {
    const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
    return Math.round((base64.length * 3) / 4 / 1024);
  };

  const resetPhotoPreview = () => {
    photoPreview.classList.remove("has-photo");
    photoPreview.style.backgroundImage = "";
    photoPreview.style.backgroundSize = "";
    photoPreview.style.backgroundPosition = "";
  };

  const applyPhotoPreview = (dataUri) => {
    photoPreview.classList.add("has-photo");
    photoPreview.style.backgroundImage = `url("${dataUri}")`;
    photoPreview.style.backgroundSize = "cover";
    photoPreview.style.backgroundPosition = "center";
  };

  const clearPhoto = () => {
    photoDataUri = "";
    resetPhotoPreview();
  };

  // createImageBitmapがあればEXIF回転（imageOrientation）を反映しつつ読み込む。
  // 未対応環境ではImage要素+ObjectURLにフォールバックする。
  const loadPhotoSource = async (file) => {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
      } catch {
        // 未対応・失敗時はフォールバックへ
      }
    }
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("photo decode failed"));
        img.src = objectUrl;
      });
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, cleanup: () => URL.revokeObjectURL(objectUrl) };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  };

  const drawScaledPhotoCanvas = (source, width, height, maxDimension) => {
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    // 透過PNGをJPEGに書き出すと透明部分が黒く潰れる（webp非対応ブラウザで起きる）。先に白で塗っておく。
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(source, 0, 0, targetWidth, targetHeight);
    return canvas;
  };

  const encodePhotoCanvas = (canvas, quality) => {
    const webp = canvas.toDataURL("image/webp", quality);
    if (webp.startsWith("data:image/webp")) return webp;
    return canvas.toDataURL("image/jpeg", quality);
  };

  const shrinkPhotoFile = async (file) => {
    const { source, width, height, cleanup } = await loadPhotoSource(file);
    try {
      let canvas = drawScaledPhotoCanvas(source, width, height, PHOTO_MAX_DIMENSION);
      let dataUri = "";
      for (const quality of PHOTO_QUALITY_STEPS) {
        dataUri = encodePhotoCanvas(canvas, quality);
        if (dataUri.length <= PHOTO_SOFT_LIMIT_CHARS) break;
      }
      if (dataUri.length > PHOTO_SOFT_LIMIT_CHARS) {
        canvas = drawScaledPhotoCanvas(source, width, height, PHOTO_FALLBACK_DIMENSION);
        dataUri = encodePhotoCanvas(canvas, PHOTO_QUALITY_STEPS[PHOTO_QUALITY_STEPS.length - 1]);
      }
      if (dataUri.length > PHOTO_HARD_LIMIT_CHARS) {
        const tooLargeError = new Error("photo too large");
        tooLargeError.photoTooLarge = true;
        throw tooLargeError;
      }
      return dataUri;
    } finally {
      cleanup();
    }
  };

  // SafariはHEICを読めるがChrome・Firefoxは読めない。事前に弾かず、実際に読めなかった時だけ案内する。
  const photoErrorMessage = (error, file) => {
    if (error && error.photoTooLarge) return "写真が大きすぎて使えませんでした。別の写真でお試しください。";
    if (/^image\/hei[cf]$/iu.test(file.type)) {
      return "iPhoneの写真（HEIC形式）は、この画面では読み込めませんでした。写真アプリで「JPEG」に変換してからお試しください。";
    }
    return "写真を読み込めませんでした。別の写真でお試しください。";
  };

  const handlePhotoChange = () => {
    const file = photoInput.files && photoInput.files[0];
    photoGeneration += 1;
    const generation = photoGeneration;

    if (!file) {
      clearPhoto();
      photoName.textContent = PHOTO_NAME_EMPTY;
      photoStatus.textContent = photoStatusDefault;
      photoProcessing = Promise.resolve();
      updateManualContactLink();
      return;
    }

    if (!file.type || !file.type.startsWith("image/")) {
      photoInput.value = "";
      clearPhoto();
      photoName.textContent = PHOTO_NAME_EMPTY;
      photoStatus.textContent = "写真は画像ファイルを選んでください。";
      photoProcessing = Promise.resolve();
      updateManualContactLink();
      return;
    }

    photoName.textContent = file.name;
    photoStatus.textContent = "写真を読み込んでいます…";
    photoProcessing = (async () => {
      try {
        const dataUri = await shrinkPhotoFile(file);
        if (generation !== photoGeneration) return;
        photoDataUri = dataUri;
        applyPhotoPreview(dataUri);
        photoStatus.textContent = `写真を読み込みました（約${estimateKbFromDataUri(dataUri)}KB）`;
      } catch (error) {
        if (generation !== photoGeneration) return;
        photoInput.value = "";
        clearPhoto();
        photoName.textContent = PHOTO_NAME_EMPTY;
        photoStatus.textContent = photoErrorMessage(error, file);
      } finally {
        if (generation === photoGeneration) updateManualContactLink();
      }
    })();
  };

  const buildSiteInput = () => {
    const catchphrase = suggestedCatchphrase();
    const menuText = getValue("menuText");
    const input = {
      storeName: getValue("shopName"),
      industry: getValue("businessType"),
      catchphrase,
      description: getValue("description"),
      colorTheme: getValue("mood"),
      phone: getValue("phone"),
      address: getValue("address"),
      businessHours: getValue("hours"),
      reserveUrl: getValue("reserveUrl"),
      instagram: getValue("instagram"),
      lineOfficial: getValue("lineOfficial"),
      ...(menuText ? { menuText } : {})
    };
    return photoDataUri ? { ...input, photo: photoDataUri } : input;
  };

  const buildApplicationText = () => {
    const values = {
      name: displayValue(getValue("shopName"), "未入力"),
      type: getValue("businessType") || "未選択",
      catchcopy: getValue("catchcopy") || "おまかせ",
      description: displayValue(getValue("description"), "未入力"),
      mood: getValue("mood") || "未選択",
      phone: displayValue(getValue("phone"), "未入力"),
      address: displayValue(getValue("address"), "未入力"),
      hours: displayValue(getValue("hours"), "未入力"),
      reserveUrl: displayValue(getValue("reserveUrl"), "未入力"),
      instagram: displayValue(getValue("instagram"), "未入力"),
      lineOfficial: displayValue(getValue("lineOfficial"), "未入力"),
      menuText: displayValue(getValue("menuText"), "未入力"),
      badgeChoice: "つけたまま",
      photo: photoDataUri ? "あり（メールに添付してください）" : "なし"
    };
    return [
      "AIホームページ製作所 申込（自動生成がうまくいかない場合）",
      "",
      `お店・活動の名前：${values.name}`,
      `業種：${values.type}`,
      `キャッチコピー：${values.catchcopy}`,
      `紹介文：${values.description}`,
      `色の雰囲気：${values.mood}`,
      `電話番号：${values.phone}`,
      `住所：${values.address}`,
      `営業時間・定休日：${values.hours}`,
      `予約ページのURL：${values.reserveUrl}`,
      `Instagram：${values.instagram}`,
      `LINE公式アカウント：${values.lineOfficial}`,
      `メニュー・料金：${values.menuText}`,
      `表示について：${values.badgeChoice}`,
      `写真：${values.photo}`
    ].join("\n");
  };

  const updateManualContactLink = () => {
    manualContactLink.href = `mailto:info@ryoseiworld.co.jp?subject=${encodeURIComponent("AIホームページ製作所の相談")}&body=${encodeURIComponent(buildApplicationText())}`;
  };

  const setGenerationState = (state) => {
    generationResult.hidden = false;
    generationLoading.hidden = state !== "loading";
    generationSuccess.hidden = state !== "success";
    generationError.hidden = state !== "error";
    generationResult.dataset.state = state;
  };

  const validationMessageFor = (detail) => {
    const messages = [
      [/^storeName is required$/u, "お店・活動の名前を入力してください。"],
      [/^storeName must be 1-40 characters$/u, "お店・活動の名前は1〜40文字で入力してください。"],
      [/^storeName contains invalid control characters$/u, "お店・活動の名前に使用できない文字が含まれています。"],
      [/^industry is invalid$/u, "業種の選択を確認してください。"],
      [/^catchphrase is required$/u, "キャッチコピーを入力してください。"],
      [/^catchphrase must be 1-60 characters$/u, "キャッチコピーは1〜60文字で入力してください。"],
      [/^description is required$/u, "紹介文を入力してください。"],
      [/^description must be 1-400 characters$/u, "紹介文は1〜400文字で入力してください。"],
      [/^colorTheme is invalid$/u, "色の雰囲気の選択を確認してください。"],
      [/^phone must be at most 40 characters$/u, "電話番号は40文字以内で入力してください。"],
      [/^address must be at most 200 characters$/u, "住所・営業時間は200文字以内で入力してください。"],
      [/^reserveUrl must be at most 300 characters$/u, "予約ページのURLは300文字以内で入力してください。"],
      [/^instagram must be at most 120 characters$/u, "Instagramのユーザー名は120文字以内で入力してください。"],
      [/^lineOfficial must be at most 120 characters$/u, "LINE公式アカウントは120文字以内で入力してください。"],
      [/^request body must be valid JSON$/u, "入力内容を読み取れませんでした。もう一度お試しください。"]
    ];
    const known = messages.find(([pattern]) => pattern.test(detail));
    if (known) return known[1];
    // サーバがすでに日本語で理由を返している場合（写真エラー等）はそのまま表示する
    if (JAPANESE_TEXT_PATTERN.test(detail)) return detail;
    return "入力内容を確認してください。必須項目を入力して、もう一度お試しください。";
  };

  const errorMessageFor = (status, serverMessage) => {
    const detail = typeof serverMessage === "string" ? serverMessage : "";
    switch (status) {
      case 400:
        return validationMessageFor(detail);
      case 401:
        return detail || "Googleでログインしてから、もう一度お試しください。";
      case 403:
        return detail || "このGoogleアカウントでは作成できませんでした。";
      case 422:
        return detail || "生成内容の確認に失敗しました。もう一度お試しください。";
      case 429:
        return detail || "生成回数の上限に達しました。時間をおいて、もう一度お試しください。";
      case 502:
        return detail || "生成サービスとの通信に失敗しました。少し時間をおいて、もう一度お試しください。";
      case 503:
        return detail || "生成サービスの準備中です。少し時間をおいて、もう一度お試しください。";
      default:
        return detail || "ホームページを生成できませんでした。もう一度お試しください。";
    }
  };

  const showError = (message) => {
    errorMessage.textContent = message;
    generationStatus.textContent = "生成できませんでした";
    setGenerationState("error");
  };

  const showSuccess = (url) => {
    generatedLink.href = url;
    generatedLink.textContent = url;
    generatedPreview.src = url;
    generatedPreview.hidden = false;
    generationStatus.textContent = "見本ができました";
    generatedCopyStatus.textContent = "";
    setGenerationState("success");
    if (typeof gtag === 'function') { gtag('event', 'apply_success', { kind: 'site' }); }
  };

  const submitGeneration = async () => {
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    applyButton.disabled = true;
    applyButton.setAttribute("aria-busy", "true");
    applyButton.dataset.defaultLabel = applyButton.textContent;
    applyButton.textContent = "見本を作っています…";
    generationStatus.textContent = "見本を生成しています…";
    setGenerationState("loading");
    ztStart();
    // 生成が速すぎても演出が一瞬で消えないよう、最低表示時間を確保する（体感の「作っている感」のため）
    const ZT_MIN_VISIBLE_MS = 1800;
    const ztMinVisible = new Promise((resolve) => setTimeout(resolve, ZT_MIN_VISIBLE_MS));

    try {
      await photoProcessing; // 写真の縮小処理が残っていれば完了を待ってから送信する
      const headers = { "content-type": "application/json" };
      if (idToken) headers.authorization = `Bearer ${idToken}`;
      const response = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(buildSiteInput())
      });
      let result = {};
      try {
        result = await response.json();
      } catch {
        result = {};
      }

      await ztMinVisible;

      if (!response.ok) {
        showError(errorMessageFor(response.status, result.error));
        return;
      }

      let generatedUrl;
      try {
        generatedUrl = new URL(result.url);
      } catch {
        showError("生成結果の公開URLを確認できませんでした。メールでご相談ください。");
        return;
      }
      if (generatedUrl.origin !== EXPECTED_WORKER_ORIGIN || generatedUrl.hostname !== "free-hp-engine.ryoseiworld.workers.dev" || !/^\/s\/[a-z0-9-]{4,80}$/u.test(generatedUrl.pathname)) {
        showError("安全を確認できない公開URLが返されたため、表示を止めました。メールでご相談ください。");
        return;
      }
      showSuccess(generatedUrl.href);
    } catch {
      await ztMinVisible;
      showError("通信に失敗しました。少し時間をおいて、もう一度お試しください。");
    } finally {
      ztStop();
      applyButton.disabled = false;
      applyButton.removeAttribute("aria-busy");
      applyButton.textContent = applyButton.dataset.defaultLabel || "ホームページを申し込む →";
    }
  };

  const copyGeneratedLink = async () => {
    const url = generatedLink.href;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      generatedCopyStatus.textContent = "リンクをコピーしました。";
    } catch {
      generatedCopyStatus.textContent = "リンクを選択しました。コピーしてください。";
      generatedLink.focus();
    }
  };

  const setSigninState = (state, message) => {
    signinArea.dataset.state = state;
    signinStatus.textContent = message || "";
  };

  const onCredential = (response) => {
    idToken = (response && response.credential) || "";
    if (!idToken) {
      setSigninState("error", "確認できませんでした。もう一度お試しください。");
      return;
    }
    // 表示名の取り出しだけのためにJWTの真ん中を読む。中身の正しさはサーバ側で確かめる。
    let who = "";
    try {
      const claims = JSON.parse(decodeURIComponent(escape(atob(idToken.split(".")[1].replace(/-/gu, "+").replace(/_/gu, "/")))));
      who = claims.email || claims.name || "";
    } catch {
      who = "";
    }
    signinButton.hidden = true;
    setSigninState("signed-in", who ? `${who} で確認できました。` : "確認できました。");
  };

  const setupGoogleSignin = () => {
    if (!googleClientId) return;
    signinArea.hidden = false;
    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onerror = () => setSigninState("error", "Googleの読み込みに失敗しました。通信環境をご確認ください。");
    script.onload = () => {
      if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        setSigninState("error", "Googleの読み込みに失敗しました。時間をおいてお試しください。");
        return;
      }
      window.google.accounts.id.initialize({ client_id: googleClientId, callback: onCredential });
      window.google.accounts.id.renderButton(signinButton, {
        type: "standard", theme: "outline", size: "large", shape: "rectangular",
        text: "signin_with", locale: "ja", width: 280
      });
    };
    document.head.appendChild(script);
  };

  form.addEventListener("input", updatePreview);
  form.addEventListener("change", updatePreview);
  form.addEventListener("input", updateManualContactLink);
  form.addEventListener("change", updateManualContactLink);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitGeneration();
  });
  photoInput.addEventListener("change", handlePhotoChange);
  copyGeneratedLinkButton.addEventListener("click", copyGeneratedLink);

  setupGoogleSignin();
  updatePreview();
  updateManualContactLink();
  expiryContactLink.href = `mailto:${EXPIRY_CONTACT_EMAIL}?subject=${encodeURIComponent(EXPIRY_CONTACT_SUBJECT)}`;
})();
