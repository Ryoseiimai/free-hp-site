/*
  ztconsole v3 "NEURAL BUILD" — 見本生成中のライブ演出（見た目のみ・実データは持たない）

  使い方: window.ztConsole.start(input) / window.ztConsole.stop()
    input = { shopName, businessType, catchcopy, description, featureLabel, featureTitle,
              menu: [{ name, price }], phone, address, hours }
  左カラム #ztconsole にHUD（ニューラルネット canvas・agentレーン・文章タイプ・コード流し・ログ・波形）を、
  右カラム #zt-preview-hud に「見本の骨組みが順に組み上がる」ワイヤーフレームを描く。両者は同じ工程で同期する。

  意図的な簡略化: 本物の生成ログではなく工程順（読む→書く→組む→確かめる→公開）のダミー演出。
  実処理と連動させるなら enterPhase / pushLog をサーバの進捗イベント（SSE等）から駆動する形に差し替える。
*/
(() => {
  "use strict";

  const MOBILE_MAX_WIDTH = 560;
  const DPR_MAX = 2;
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SLOW = REDUCED_MOTION ? 4 : 1; // reduced-motion時は更新頻度を落とす

  const TICK_MS = 100;               // レーン・時計の更新間隔
  const WAVE_MS = 170;               // 波形が1コマ左へ流れる間隔
  const METRIC_MS = 120;             // HUD数値の更新間隔
  const LANE_SPEED_PX = 3;           // 1tickでタイムラインが進むpx
  const LANE_RIGHT_PAD_PX = 28;
  const LANE_PRUNE_PX = 40;
  const MARK_CHANCE = 0.14;
  const MARK_MIN_SPACING_PX = 9;
  const LOG_MAX_LINES = 6;
  const LOG_WINDOW = 2;              // 同工程内で「次の候補」として見る行数
  const WAVE_GLYPHS = ["×", "◆", "*", "※", "+", "·"];
  const WAVE_GLYPH_CHANCE = 0.3;
  const WAVE_HOT = 72;
  const WAVE_WARM = 48;

  const STREAM_MAX_LINES = 16;       // コード流しの保持行数
  const STREAM_MS = [70, 160];       // 通常の1行あたり間隔（読める速さ）
  const STREAM_BURST_CHANCE = 0.12;  // 一気に流れる（読めない速さ）バーストの確率
  const STREAM_BURST_LINES = 6;
  const STREAM_BURST_MS = 28;

  const TYPE_MS = [28, 95];          // 文章タイプの1トークン間隔
  const TYPE_PAUSE_CHANCE = 0.08;    // LLMっぽい「考え込む」間の確率
  const TYPE_PAUSE_MS = [260, 520];
  const SEGMENT_HOLD_MS = 620;       // 1項目を書き終えて✓を見せる時間
  const SEGMENT_GAP_MS = 240;
  const SEGMENT_LOOP_FROM = 2;       // 全項目を書き終えたら input.* を飛ばしてここから再開
  const CLIP_LONG = 84;
  const CLIP_META = 70;
  const CLIP_PREVIEW = 60;

  const PROGRESS_EASE = 0.1;         // 表示%が目標へ寄る速さ
  const PROGRESS_LOOP_STEP = 0.35;   // deploying の loop 1行ごとに進む%
  const PROGRESS_CAP = 97;           // 完了までは100%に達しない
  const TPS_EASE = 0.35;
  const LATENCY_RANGE = [18, 95];
  const LATENCY_SPIKE_CHANCE = 0.05;
  const LATENCY_SPIKE = 140;

  const NET_LAYERS_DESKTOP = [5, 7, 7, 4];
  const NET_LAYERS_MOBILE = [4, 5, 5, 3];
  const NET_X_INSET = 0.07;
  const NET_JITTER_PX = 9;
  const NET_WOBBLE_PX = 3;
  const NET_SIGNAL_MS = [320, 620];  // 1辺を信号が渡り切る時間
  const NET_SIGNAL_BRANCH = 0.22;    // 到着時に2本へ分岐する確率
  const NET_SIGNAL_CONTINUE = 0.9;   // 到着時に次の層へ進む確率
  const NET_SPAWN_MIN_MS = 60;
  const NET_SPAWN_MAX_MS = 420;
  const NET_ENERGY_DECAY_MS = 640;
  const NET_BURST_MS = 760;
  const NET_BURST_SIGNALS = 8;
  const NET_MAX_SIGNALS = 90;
  const NET_MAX_DT = 50;

  const PHUD_BUILD_STAGGER_MS = 900; // 骨組み1ブロックが組み上がる間隔
  const PHUD_ROW_TYPE_MS = 24;
  const PHUD_SCAN_STAGGER_MS = 260;
  const PHUD_VERIFY_STAGGER_MS = 320;
  const PHUD_HIDE_MS = 720;          // 完了後、本物の見本へ切り替わるフェード時間
  const BANNER_MS = 1500;
  const GLITCH_MS = 420;
  const GLITCH_CHANCE_PER_TICK = 0.018;

  const COLORS = {
    ochre: "#C9A227",
    green: "#4ADE80",
    red: "#E2645C",
    cyan: "#4FD1E8",
    ink: "245, 241, 228"
  };

  // 工程。range=進捗%の範囲、tps=tokens/s の揺れ幅。lines の kind: ok=● / write=◆ / fail=×
  const PHASES = [
    { id: "reading", code: "01", en: "READING", ja: "お店の情報を読み込んでいます", range: [0, 18], tps: [280, 620], logMs: 520,
      lines: [
        ["ok", "Read", "shop-name → 入力内容"],
        ["ok", "Read", "業種 → テンプレートを選択"],
        ["ok", "Read", "写真 → sample-hero.jpg"],
        ["ok", "Grep", "電話番号 / 住所 / 営業時間"]
      ] },
    { id: "composing", code: "02", en: "COMPOSING", ja: "文章を書いています", range: [18, 45], tps: [1700, 2600], logMs: 620,
      lines: [
        ["ok", "Plan", "セクション構成 hero / menu / access"],
        ["ok", "Think", "catchcopy 候補を3案 生成"],
        ["write", "Edit", "mood palette → 色の雰囲気を反映"],
        ["ok", "Think", "メニュー・料金を整形"],
        ["write", "Write", "copy/hero.md"]
      ] },
    { id: "building", code: "03", en: "BUILDING", ja: "ページを組み立てています", range: [45, 75], tps: [1100, 1900], logMs: 700,
      lines: [
        ["write", "Write", "hero-section.html"],
        ["write", "Write", "menu-section.html"],
        ["ok", "Bash", "convert photo → webp (q=82)"],
        ["fail", "Bash failed", "fetch fonts · retry (1/2)"],
        ["ok", "Bash", "fetch fonts ✓"],
        ["write", "Edit", "footer links を配置"],
        ["ok", "Bash", "npm run build"]
      ] },
    { id: "verifying", code: "04", en: "VERIFYING", ja: "仕上がりを確認しています", range: [75, 90], tps: [400, 900], logMs: 800,
      lines: [
        ["ok", "Check", "HTML structure valid"],
        ["ok", "Check", "mobile layout 375px"],
        ["ok", "Check", "tel: リンク / 地図リンク"],
        ["ok", "Check", "contrast / a11y"]
      ] },
    { id: "deploying", code: "05", en: "DEPLOYING", ja: "見本を公開しています", range: [90, PROGRESS_CAP], tps: [150, 420], logMs: 1000,
      lines: [
        ["write", "Write", "generated/site.html"],
        ["ok", "Deploy", "→ workers.dev"],
        ["ok", "Wait", "edge cache warming…"],
        ["ok", "Deploy", "見本URLを発行中"]
      ],
      loop: [
        ["ok", "Wait", "edge cache warming…"],
        ["ok", "Poll", "deploy status"],
        ["ok", "Check", "DNS propagation"],
        ["ok", "Wait", "見本URLの応答を確認中"]
      ] }
  ];
  const PHASE_COMPOSING = 1;
  const PHASE_BUILDING = 2;
  const PHASE_VERIFYING = 3;
  const PHASE_DEPLOYING = 4;

  const LANES = [
    { label: "main", startX: 0, dur: [60, 170], gap: [6, 18] },
    { label: "sub·1", startX: 45, dur: [30, 120], gap: [10, 48] },
    { label: "sub·2", startX: 120, dur: [24, 90], gap: [16, 70] }
  ];

  const root = document.querySelector("#ztconsole");
  const previewHost = document.querySelector("#zt-preview-hud");
  const previewBrowser = previewHost ? previewHost.closest(".mini-browser") : null;

  const isMobile = () => window.innerWidth <= MOBILE_MAX_WIDTH;
  const rand = ([min, max]) => min + Math.random() * (max - min);
  const randInt = ([min, max]) => Math.round(rand([min, max]));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const pad2 = (n) => String(n).padStart(2, "0");
  const clip = (text, max) => (text && text.length > max ? `${text.slice(0, max - 1)}…` : text || "");
  const fmtInt = (n) => Math.round(n).toLocaleString("en-US");
  const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
  const clockText = (now) =>
    `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ---------- 状態 ----------
  const state = {
    running: false,
    input: null,
    timeouts: new Set(),
    intervals: [],
    rafId: 0,
    hideTimer: 0,
    inView: true,
    resizeObserver: null,
    intersection: null,
    onVisibility: null,
    onResize: null,
    x: 0,
    tools: 0,
    agents: 1,
    lanes: [],
    wave: [],
    glyphs: [],
    phaseIndex: 0,
    pending: [],
    forcedNext: null,
    lastLogText: "",
    lastStream: "",
    phaseLinesTotal: 1,
    progressTarget: 0,
    progress: 0,
    tps: 0,
    ctxTokens: 0,
    segments: [],
    segIndex: 0,
    net: { nodes: [], edges: [], signals: [], burst: -1, spawnAt: 0, w: 0, h: 0, dpr: 1, last: 0 },
    phud: { blocks: [] }
  };

  const dom = {};

  // タイマーは全部ここを通す（stopで確実に止めるため）
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      state.timeouts.delete(id);
      if (state.running) fn();
    }, ms * SLOW);
    state.timeouts.add(id);
    return id;
  };
  const every = (fn, ms) => {
    state.intervals.push(setInterval(fn, ms * SLOW));
  };

  // ---------- DOM構築 ----------
  const buildConsole = () => {
    root.textContent = "";
    root.classList.add("is-v3");

    dom.canvas = el("canvas", "zt-net");
    dom.grid = el("div", "zt-grid");
    dom.sweep = el("div", "zt-sweep");
    dom.scan = el("div", "zt-scanlines");
    dom.flash = el("div", "zt-flash");

    // HUD ヘッダー
    const hud = el("div", "zt-hud");
    const hudLeft = el("div", "zt-hud-left");
    const brand = el("div", "zt-hud-brand");
    brand.append(el("i", "zt-hud-dot"), document.createTextNode("freehp-engine "), el("b", "", "NEURAL BUILD"));
    const phase = el("div", "zt-hud-phase");
    dom.phaseCode = el("span", "zt-hud-phase-code", "01");
    dom.phaseEn = el("span", "zt-hud-phase-en", "READING");
    dom.phaseJa = el("span", "zt-hud-phase-ja", "");
    phase.append(dom.phaseCode, dom.phaseEn, dom.phaseJa);
    dom.steps = el("div", "zt-hud-steps");
    PHASES.forEach((p) => {
      const step = el("i", "");
      step.title = p.en;
      dom.steps.appendChild(step);
    });
    hudLeft.append(brand, phase, dom.steps);

    const hudRight = el("div", "zt-hud-right");
    dom.ring = el("div", "zt-ring");
    dom.ringVal = el("span", "zt-ring-val", "0");
    dom.ringVal.appendChild(el("i", "", "%"));
    dom.ring.append(el("span", "zt-ring-track"), dom.ringVal);
    const metrics = el("dl", "zt-metrics");
    const metric = (label) => {
      const wrap = el("div", "");
      const dd = el("dd", "", "—");
      wrap.append(el("dt", "", label), dd);
      metrics.appendChild(wrap);
      return dd;
    };
    dom.mTps = metric("tokens/s");
    dom.mLatency = metric("latency");
    dom.mCtx = metric("context");
    dom.mAgents = metric("agents");
    dom.mTools = metric("tools");
    hudRight.append(dom.ring, metrics);
    hud.append(hudLeft, hudRight);

    // agentレーン
    dom.lanes = el("div", "ztconsole-lanes");

    // 文章タイプ + コード流し
    const mid = el("div", "zt-mid");
    const composer = el("div", "zt-composer");
    const composerHead = el("div", "zt-composer-head");
    dom.composerField = el("span", "zt-composer-field", "");
    dom.composerState = el("span", "zt-composer-state", "writing");
    composerHead.append(el("span", "zt-composer-pen", "✎"), dom.composerField, dom.composerState);
    dom.composerBody = el("div", "zt-composer-body");
    dom.composerText = el("span", "zt-composer-text", "");
    dom.composerBody.append(dom.composerText, el("i", "zt-caret"));
    composer.append(composerHead, dom.composerBody);
    dom.stream = el("div", "zt-stream");
    mid.append(composer, dom.stream);

    // ログ・波形・メタ・フッター
    dom.log = el("div", "ztconsole-log");
    const wave = el("div", "ztconsole-wave");
    dom.waveGlyphs = el("div", "ztconsole-wave-glyphs");
    dom.waveBars = el("div", "ztconsole-wave-bars");
    wave.append(dom.waveGlyphs, dom.waveBars, el("span", "ztconsole-wave-cursor"));
    const meta = el("div", "ztconsole-meta");
    dom.clock = el("span", "ztconsole-clock", "");
    const live = el("span", "ztconsole-live");
    live.append(el("span", "ztconsole-live-dot"), document.createTextNode("LIVE"));
    meta.append(dom.clock, live);
    const footer = el("div", "ztconsole-footer");
    const session = el("span", "ztconsole-session", "session ");
    session.appendChild(el("b", "", "site-generator"));
    dom.count = el("span", "ztconsole-count", "1 agent · 0 tools");
    dom.phaseFoot = el("span", "ztconsole-phase", "reading");
    footer.append(el("span", "ztconsole-brand", "freehp-engine"), session, dom.count, dom.phaseFoot, el("span", "ztconsole-hint", "q quit · ? help · space pause"));

    // 工程切替バナー
    dom.banner = el("div", "zt-banner");
    dom.bannerCode = el("span", "zt-banner-code", "");
    dom.bannerEn = el("span", "zt-banner-en", "");
    dom.bannerJa = el("span", "zt-banner-ja", "");
    dom.banner.append(dom.bannerCode, dom.bannerEn, dom.bannerJa);

    root.append(dom.canvas, dom.grid, dom.sweep, hud, dom.lanes, mid, dom.log, wave, meta, footer, dom.scan, dom.flash, dom.banner);
  };

  // ---------- レーン ----------
  const buildLanes = () => {
    dom.lanes.textContent = "";
    state.lanes = LANES.map((cfg, index) => {
      const lane = el("div", `ztconsole-lane ${index === 0 ? "is-main" : "is-idle"}`);
      const track = el("div", "ztconsole-lane-track");
      const strip = el("div", "ztconsole-lane-strip");
      track.appendChild(strip);
      lane.append(el("span", "ztconsole-lane-label", cfg.label), track);
      dom.lanes.appendChild(lane);
      return { cfg, el: lane, track, strip, bars: [], active: null, nextStartX: cfg.startX };
    });
  };

  const createBar = (lane, x) => {
    const bar = el("span", "ztconsole-lane-bar is-active");
    bar.style.left = `${x}px`;
    bar.style.width = "0px";
    lane.strip.appendChild(bar);
    const record = { el: bar, startX: x, endX: x + randInt(lane.cfg.dur), width: 0, lastMarkAt: -MARK_MIN_SPACING_PX };
    lane.bars.push(record);
    if (lane !== state.lanes[0]) state.agents += 1; // subのバー1本＝子agent1体
    return record;
  };

  const addMark = (bar, atX) => {
    if (atX - bar.lastMarkAt < MARK_MIN_SPACING_PX) return;
    const mark = el("i", "ztconsole-lane-mark");
    mark.style.left = `${atX}px`;
    bar.el.appendChild(mark);
    bar.lastMarkAt = atX;
    state.tools += 1;
  };

  const tickLanes = () => {
    if (!state.lanes.length) return;
    state.x += LANE_SPEED_PX;
    const x = state.x;
    const trackWidth = state.lanes[0].track.clientWidth;
    const offset = Math.max(0, x - trackWidth + LANE_RIGHT_PAD_PX);
    state.lanes.forEach((lane) => {
      if (x < lane.cfg.startX) return;
      lane.el.classList.remove("is-idle");
      if (lane.active) {
        const bar = lane.active;
        bar.width = x - bar.startX;
        bar.el.style.width = `${bar.width}px`;
        if (Math.random() < MARK_CHANCE) addMark(bar, bar.width);
        if (x >= bar.endX) {
          bar.el.classList.remove("is-active");
          lane.active = null;
          lane.nextStartX = x + randInt(lane.cfg.gap);
        }
      } else if (x >= lane.nextStartX) {
        lane.active = createBar(lane, x);
      }
      lane.strip.style.transform = `translateX(${-offset}px)`;
      while (lane.bars.length && lane.bars[0].startX + lane.bars[0].width < offset - LANE_PRUNE_PX) {
        lane.bars.shift().el.remove();
      }
    });
    dom.clock.textContent = clockText(new Date());
    if (!REDUCED_MOTION && Math.random() < GLITCH_CHANCE_PER_TICK) glitch();
  };

  // ---------- 波形 ----------
  const buildWave = () => {
    dom.waveBars.textContent = "";
    dom.waveGlyphs.textContent = "";
    state.wave = [];
    state.glyphs = [];
    const count = isMobile() ? 30 : 52;
    for (let i = 0; i < count; i += 1) {
      const bar = el("span", "ztconsole-wave-bar");
      dom.waveBars.appendChild(bar);
      const glyph = el("span", "");
      dom.waveGlyphs.appendChild(glyph);
      state.wave.push({ el: bar, height: 10 + Math.round(Math.random() * 60) });
      state.glyphs.push({ el: glyph, text: "" });
    }
  };

  const nextWaveHeight = (prev) => {
    const spike = Math.random() < 0.12 ? 40 : 0;
    const next = prev * 0.45 + (8 + Math.random() * 62) * 0.55 + spike;
    return Math.max(6, Math.min(100, Math.round(next)));
  };

  const tickWave = () => {
    const { wave, glyphs } = state;
    if (!wave.length) return;
    const heights = wave.map((w) => w.height);
    heights.shift();
    heights.push(nextWaveHeight(heights[heights.length - 1]));
    const texts = glyphs.map((g) => g.text);
    texts.shift();
    texts.push(Math.random() > WAVE_GLYPH_CHANCE ? "" : pick(WAVE_GLYPHS));
    wave.forEach((w, i) => {
      w.height = heights[i];
      w.el.style.height = `${w.height}%`;
      w.el.classList.toggle("is-hot", w.height >= WAVE_HOT);
      w.el.classList.toggle("is-warm", w.height >= WAVE_WARM && w.height < WAVE_HOT);
    });
    glyphs.forEach((g, i) => {
      g.text = texts[i];
      g.el.textContent = g.text;
      g.el.className = g.text === "×" ? "is-fail" : g.text === "◆" ? "is-warn" : g.text === "*" || g.text === "※" ? "is-hot" : "";
    });
  };

  // ---------- 工程（phase） ----------
  const currentPhase = () => PHASES[Math.min(state.phaseIndex, PHASES.length - 1)];

  const phaseProgress = () => {
    const phase = currentPhase();
    const done = state.phaseLinesTotal - state.pending.length;
    const [from, to] = phase.range;
    return from + (to - from) * Math.min(1, done / Math.max(1, state.phaseLinesTotal));
  };

  const glitch = () => {
    root.classList.add("is-glitch");
    later(() => root.classList.remove("is-glitch"), GLITCH_MS);
  };

  const showBanner = (phase) => {
    dom.bannerCode.textContent = `PHASE ${phase.code} / ${pad2(PHASES.length)}`;
    dom.bannerEn.textContent = phase.en;
    dom.bannerEn.dataset.text = phase.en;
    dom.bannerJa.textContent = phase.ja;
    // アニメーションを毎回頭から再生する
    dom.banner.classList.remove("is-on");
    dom.flash.classList.remove("is-on");
    void dom.banner.offsetWidth;
    dom.banner.classList.add("is-on");
    dom.flash.classList.add("is-on");
    later(() => {
      dom.banner.classList.remove("is-on");
      dom.flash.classList.remove("is-on");
    }, BANNER_MS);
  };

  const enterPhase = (index) => {
    state.phaseIndex = index;
    const phase = currentPhase();
    // fail 行は直後の行（リトライ成功）を抱き合わせにして順序を守る
    const pending = [];
    for (let i = 0; i < phase.lines.length; i += 1) {
      const line = phase.lines[i];
      const then = line[0] === "fail" && i + 1 < phase.lines.length ? phase.lines[i + 1] : null;
      pending.push({ line, then });
      if (then) i += 1;
    }
    state.pending = pending;
    state.phaseLinesTotal = pending.length;
    state.progressTarget = phase.range[0];

    dom.phaseCode.textContent = phase.code;
    dom.phaseEn.textContent = phase.en;
    dom.phaseEn.dataset.text = phase.en;
    dom.phaseJa.textContent = phase.ja;
    dom.phaseFoot.textContent = phase.id;
    root.dataset.phase = phase.id;
    Array.from(dom.steps.children).forEach((step, i) => {
      step.className = i < index ? "is-done" : i === index ? "is-current" : "";
    });
    if (index > 0) {
      showBanner(phase);
      glitch();
      netBurst();
    }
    phudEnterPhase(index);
  };

  // ---------- ログ ----------
  const pickLine = () => {
    if (state.forcedNext) {
      const forced = state.forcedNext;
      state.forcedNext = null;
      return forced;
    }
    if (!state.pending.length) {
      if (state.phaseIndex < PHASES.length - 1) {
        enterPhase(state.phaseIndex + 1);
      } else {
        state.progressTarget = Math.min(PROGRESS_CAP, state.progressTarget + PROGRESS_LOOP_STEP);
        const loop = currentPhase().loop.filter((line) => line[2] !== state.lastLogText);
        return pick(loop);
      }
    }
    const windowSize = Math.min(LOG_WINDOW, state.pending.length);
    const entry = state.pending.splice(Math.floor(Math.random() * windowSize), 1)[0];
    if (entry.then) state.forcedNext = entry.then;
    state.progressTarget = Math.max(state.progressTarget, phaseProgress());
    return entry.line;
  };

  const pushLog = () => {
    const [kind, cmd, text] = pickLine();
    state.lastLogText = text;
    const line = el("p", `ztconsole-log-line${kind === "fail" ? " is-fail" : ""}`);
    const now = new Date();
    line.append(
      el("span", "ztconsole-log-time", `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`),
      el("span", `ztconsole-log-mark is-${kind}`, kind === "fail" ? "×" : kind === "write" ? "◆" : "●"),
      el("span", "ztconsole-log-cmd", `${cmd} · `),
      el("span", "ztconsole-log-text", text)
    );
    dom.log.appendChild(line);
    while (dom.log.childElementCount > LOG_MAX_LINES) dom.log.removeChild(dom.log.firstChild);
    state.tools += 1;
  };

  const scheduleLog = () => {
    pushLog();
    later(scheduleLog, currentPhase().logMs);
  };

  // ---------- 文章タイプ（AIが書いた文をトークン単位で打つ） ----------
  const buildSegments = (input) => {
    const menu = (input.menu || []).slice(0, 3);
    const access = [input.phone, input.address, input.hours].filter(Boolean).join(" · ");
    const segs = [
      { field: "input.shopName", text: input.shopName, fast: true },
      { field: "input.businessType", text: input.businessType, fast: true },
      { field: "hero.catchcopy", text: input.catchcopy },
      { field: "hero.description", text: clip(input.description, CLIP_LONG) },
      ...menu.map((m, i) => ({ field: `menu[${i}].name`, text: m.price ? `${m.name} — ${m.price}` : m.name })),
      { field: "feature.title", text: input.featureTitle },
      { field: "meta.title", text: `${input.shopName}｜${input.catchcopy}` },
      { field: "meta.description", text: clip(input.description, CLIP_META) },
      { field: "og:image.alt", text: `${input.shopName}の写真` },
      { field: "footer.access", text: access },
      { field: "hero.catchcopy · v2", text: input.catchcopy }
    ];
    return segs.filter((s) => s.text && s.text.trim());
  };

  // 日本語は1〜3文字、英数字は単語単位で区切る（LLMのトークン風）
  const tokenize = (text) => {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (/[A-Za-z0-9¥.,:\-—]/u.test(ch)) {
        let j = i;
        while (j < text.length && /[A-Za-z0-9¥.,:\-—]/u.test(text[j])) j += 1;
        tokens.push(text.slice(i, j));
        i = j;
      } else {
        const len = 1 + Math.floor(Math.random() * 3);
        tokens.push(text.slice(i, i + len));
        i += len;
      }
    }
    return tokens;
  };

  const typeSegment = () => {
    if (!state.segments.length) return;
    if (state.segIndex >= state.segments.length) state.segIndex = Math.min(SEGMENT_LOOP_FROM, state.segments.length - 1);
    const seg = state.segments[state.segIndex];
    state.segIndex += 1;
    dom.composerField.textContent = seg.field;
    dom.composerState.textContent = seg.fast ? "reading" : "writing";
    dom.composerBody.classList.remove("is-committed");
    dom.composerText.textContent = "";
    const tokens = tokenize(seg.text);
    if (REDUCED_MOTION) {
      dom.composerText.textContent = seg.text;
      later(commitSegment, SEGMENT_HOLD_MS);
      return;
    }
    let idx = 0;
    const step = () => {
      if (idx >= tokens.length) {
        commitSegment();
        return;
      }
      dom.composerText.textContent += tokens[idx];
      idx += 1;
      const base = seg.fast ? TYPE_MS[0] : rand(TYPE_MS);
      const pause = !seg.fast && Math.random() < TYPE_PAUSE_CHANCE ? rand(TYPE_PAUSE_MS) : 0;
      later(step, base + pause);
    };
    step();
  };

  const commitSegment = () => {
    dom.composerState.textContent = "committed ✓";
    dom.composerBody.classList.add("is-committed");
    later(typeSegment, SEGMENT_HOLD_MS + SEGMENT_GAP_MS);
  };

  // ---------- コード流し（HTML/CSS片が流れるレイヤー） ----------
  const buildStreamLines = (input) => {
    const shop = input.shopName || "your-shop";
    const type = input.businessType || "shop";
    const catchcopy = clip(input.catchcopy || "", 28);
    const desc = clip(input.description || "", 36);
    const menu = (input.menu || []).slice(0, 3);
    return [
      "<!doctype html>",
      `<html lang="ja" data-mood="${type}">`,
      `<title>${shop}｜${catchcopy}</title>`,
      `<meta name="description" content="${desc}">`,
      '<link rel="preload" as="font" href="/fonts/ZenKaku.woff2">',
      '<header class="site-header">',
      `  <h1 class="brand">${shop}</h1>`,
      '<section class="hero">',
      `  <p class="kicker">${type}</p>`,
      `  <h2 class="hero-title">${catchcopy}</h2>`,
      `  <img src="hero.webp" alt="${shop}の写真" loading="eager">`,
      '<section class="about">',
      `  <p>${desc}</p>`,
      ...menu.map((m) => `  <li><span>${m.name}</span><b>${m.price || ""}</b></li>`),
      '<section class="menu"><ul class="menu-list">',
      `<a class="cta" href="tel:${input.phone || "000-0000-0000"}">電話する</a>`,
      `<address>${clip(input.address || "住所", 24)}</address>`,
      ":root { --accent: #C96F3B; --ink: #241A02; --paper: #F5F1E4; }",
      ".hero { padding: 64px 24px; background: var(--accent); color: var(--paper); }",
      ".hero-title { font-family: 'Shippori Mincho'; font-size: clamp(24px, 5vw, 40px); }",
      ".menu-list li { display: flex; justify-content: space-between; }",
      "@media (max-width: 480px) { .hero { padding: 40px 16px; } }",
      ".cta { background: var(--accent); border-radius: 0; padding: 12px 20px; }",
      "img { max-width: 100%; height: auto; display: block; }",
      '{"section":"hero","tokens":412,"confidence":0.97}',
      '{"section":"menu","items":' + menu.length + ',"currency":"JPY"}',
      '{"check":"contrast","ratio":6.2,"pass":true}',
      '{"check":"viewport","width":375,"overflow":false}',
      "▸ attention → hero.catchcopy (0.83)",
      "▸ attention → menu[0].price (0.61)",
      "▸ sampling temperature=0.4 top_p=0.9",
      "▸ tool: write_file hero-section.html (2.1kB)",
      "▸ tool: image_convert hero.jpg → webp q=82",
      "▸ cache: fonts/ZenKaku.woff2 HIT",
      "PUT /kv/sites/" + shop.replace(/\s+/gu, "-").toLowerCase().slice(0, 12) + " 201 Created",
      "GET /s/preview 200 OK 38ms"
    ];
  };

  const pushStreamLine = () => {
    const lines = state.streamLines;
    let text = pick(lines);
    if (text === state.lastStream) text = pick(lines);
    state.lastStream = text;
    const r = Math.random();
    const line = el("p", `zt-stream-line${r < 0.15 ? " is-hi" : r < 0.55 ? " is-dim" : ""}`, text);
    dom.stream.appendChild(line);
    while (dom.stream.childElementCount > STREAM_MAX_LINES) dom.stream.removeChild(dom.stream.firstChild);
    state.ctxTokens += text.length * 0.6;
  };

  const scheduleStream = () => {
    if (Math.random() < STREAM_BURST_CHANCE) {
      let n = 0;
      const burst = () => {
        pushStreamLine();
        n += 1;
        if (n < STREAM_BURST_LINES) later(burst, STREAM_BURST_MS);
        else later(scheduleStream, rand(STREAM_MS));
      };
      burst();
      return;
    }
    pushStreamLine();
    later(scheduleStream, rand(STREAM_MS));
  };

  // ---------- HUD 数値 ----------
  const tickMetrics = () => {
    const phase = currentPhase();
    state.tps += (rand(phase.tps) - state.tps) * TPS_EASE;
    state.ctxTokens += state.tps * (METRIC_MS / 1000);
    state.progress += (state.progressTarget - state.progress) * PROGRESS_EASE;
    const latency = Math.random() < LATENCY_SPIKE_CHANCE ? LATENCY_SPIKE : rand(LATENCY_RANGE);
    dom.mTps.textContent = fmtInt(state.tps);
    dom.mLatency.textContent = `${Math.round(latency)} ms`;
    dom.mCtx.textContent = fmtK(state.ctxTokens);
    dom.mAgents.textContent = String(state.agents);
    dom.mTools.textContent = String(state.tools);
    dom.count.textContent = `${state.agents} agent${state.agents === 1 ? "" : "s"} · ${state.tools} tools`;
    const pct = Math.floor(state.progress);
    dom.ring.style.setProperty("--p", state.progress.toFixed(1));
    dom.ringVal.firstChild.textContent = String(pct);
    if (dom.phudPct) dom.phudPct.textContent = `${pct}%`;
  };

  // ---------- ニューラルネット canvas ----------
  const netBurst = () => {
    const net = state.net;
    net.burst = 0;
    net.nodes.forEach((n) => { n.energy = 1; });
    for (let i = 0; i < NET_BURST_SIGNALS; i += 1) spawnSignal();
  };

  const resizeNet = () => {
    const net = state.net;
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    net.dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    net.w = rect.width;
    net.h = rect.height;
    dom.canvas.width = Math.round(net.w * net.dpr);
    dom.canvas.height = Math.round(net.h * net.dpr);
    dom.canvas.style.width = `${net.w}px`;
    dom.canvas.style.height = `${net.h}px`;
    buildNet();
    if (REDUCED_MOTION) drawNet(0);
  };

  const buildNet = () => {
    const net = state.net;
    const layers = isMobile() ? NET_LAYERS_MOBILE : NET_LAYERS_DESKTOP;
    net.nodes = [];
    net.edges = [];
    net.signals = [];
    layers.forEach((count, li) => {
      const x = net.w * (NET_X_INSET + (1 - NET_X_INSET * 2) * (li / (layers.length - 1)));
      for (let i = 0; i < count; i += 1) {
        const y = net.h * ((i + 1) / (count + 1));
        net.nodes.push({
          layer: li,
          bx: x + (Math.random() - 0.5) * NET_JITTER_PX * 2,
          by: y + (Math.random() - 0.5) * NET_JITTER_PX * 2,
          x, y,
          energy: 0,
          seed: Math.random() * Math.PI * 2,
          out: []
        });
      }
    });
    net.nodes.forEach((a) => {
      net.nodes.forEach((b) => {
        if (b.layer !== a.layer + 1) return;
        const edge = { a, b };
        net.edges.push(edge);
        a.out.push(edge);
      });
    });
  };

  const spawnSignal = (from) => {
    const net = state.net;
    if (net.signals.length >= NET_MAX_SIGNALS) return;
    const source = from || pick(net.nodes.filter((n) => n.layer === 0));
    if (!source || !source.out.length) return;
    source.energy = Math.max(source.energy, 0.7);
    net.signals.push({ edge: pick(source.out), t: 0, ms: rand(NET_SIGNAL_MS) });
  };

  const stepNet = (dt, ts) => {
    const net = state.net;
    const decay = dt / NET_ENERGY_DECAY_MS;
    net.nodes.forEach((n) => {
      n.energy = Math.max(0, n.energy - decay);
      n.x = n.bx + Math.sin(ts * 0.0007 + n.seed) * NET_WOBBLE_PX;
      n.y = n.by + Math.cos(ts * 0.0005 + n.seed) * NET_WOBBLE_PX;
    });
    const arrived = [];
    net.signals = net.signals.filter((s) => {
      s.t += dt / s.ms;
      if (s.t < 1) return true;
      arrived.push(s.edge.b);
      return false;
    });
    arrived.forEach((node) => {
      node.energy = 1;
      if (Math.random() < NET_SIGNAL_CONTINUE) spawnSignal(node);
      if (Math.random() < NET_SIGNAL_BRANCH) spawnSignal(node);
    });
    // tokens/s が高いほど信号が多く走る
    const interval = Math.max(NET_SPAWN_MIN_MS, Math.min(NET_SPAWN_MAX_MS, 140000 / Math.max(1, state.tps)));
    if (ts >= net.spawnAt) {
      spawnSignal();
      net.spawnAt = ts + interval;
    }
    if (net.burst >= 0) {
      net.burst += dt / NET_BURST_MS;
      if (net.burst >= 1) net.burst = -1;
    }
  };

  const drawNet = (ts) => {
    const net = state.net;
    const ctx = dom.canvas.getContext("2d");
    if (!ctx || !net.w) return;
    ctx.setTransform(net.dpr, 0, 0, net.dpr, 0, 0);
    ctx.clearRect(0, 0, net.w, net.h);
    const phaseHot = state.phaseIndex === PHASE_COMPOSING || state.phaseIndex === PHASE_BUILDING;
    const fire = phaseHot ? COLORS.cyan : COLORS.green;

    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${COLORS.ink}, .11)`;
    ctx.beginPath();
    net.edges.forEach(({ a, b }) => {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    });
    ctx.stroke();

    net.signals.forEach((s) => {
      const { a, b } = s.edge;
      const t = s.t;
      const t0 = Math.max(0, t - 0.14);
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const x0 = a.x + (b.x - a.x) * t0;
      const y0 = a.y + (b.y - a.y) * t0;
      const grad = ctx.createLinearGradient(x0, y0, x, y);
      grad.addColorStop(0, "rgba(79, 209, 232, 0)");
      grad.addColorStop(1, "rgba(79, 209, 232, .85)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(79, 209, 232, .25)";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#DFFBFF";
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    });

    net.nodes.forEach((n) => {
      const e = n.energy;
      if (e > 0.02) {
        ctx.fillStyle = fire;
        ctx.globalAlpha = e * 0.28;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 3 + e * 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = e > 0.05 ? fire : `rgba(${COLORS.ink}, .55)`;
      ctx.globalAlpha = 0.5 + e * 0.5;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 2.2 + e * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `rgba(${COLORS.ink}, ${0.12 + e * 0.5})`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 5.5 + e * 3, 0, Math.PI * 2);
      ctx.stroke();
    });

    if (net.burst >= 0) {
      const k = net.burst;
      const radius = Math.max(net.w, net.h) * 0.75 * k;
      ctx.strokeStyle = `rgba(79, 209, 232, ${(1 - k) * 0.55})`;
      ctx.lineWidth = 2 - k;
      ctx.beginPath();
      ctx.arc(net.w / 2, net.h / 2, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  const frame = (ts) => {
    if (!state.running) return;
    const net = state.net;
    const dt = Math.min(NET_MAX_DT, net.last ? ts - net.last : 16);
    net.last = ts;
    if (state.inView && !document.hidden) {
      stepNet(dt, ts);
      drawNet(ts);
    }
    state.rafId = requestAnimationFrame(frame);
  };

  // ---------- 右カラム: 見本の骨組みが順に組み上がる ----------
  const buildPreviewBlocks = (input) => {
    const menu = (input.menu || []).slice(0, 3);
    const blocks = [
      { id: "header", tag: "header", phase: PHASE_COMPOSING, rows: [{ kind: "title", text: input.shopName }] },
      { id: "hero", tag: "hero", phase: PHASE_COMPOSING, rows: [
        { kind: "kicker", text: input.businessType },
        { kind: "h", text: clip(input.catchcopy, 40) },
        { kind: "photo" }
      ] },
      { id: "about", tag: "about", phase: PHASE_BUILDING, rows: [{ kind: "p", text: clip(input.description, CLIP_PREVIEW) }] },
      { id: "feature", tag: "feature", phase: PHASE_BUILDING, rows: [
        { kind: "label", text: input.featureLabel },
        { kind: "strong", text: clip(input.featureTitle, 30) }
      ] },
      menu.length ? { id: "menu", tag: "menu", phase: PHASE_BUILDING, rows: menu.map((m) => ({ kind: "menu", text: m.name, price: m.price })) } : null,
      { id: "access", tag: "access", phase: PHASE_BUILDING, rows: [
        { kind: "small", text: input.phone },
        { kind: "small", text: input.address },
        { kind: "small", text: input.hours }
      ] }
    ].filter(Boolean);
    blocks.forEach((b) => { b.rows = b.rows.filter((r) => r.kind === "photo" || (r.text && r.text.trim())); });
    return blocks.filter((b) => b.rows.length);
  };

  const buildPreviewHud = (input) => {
    if (!previewHost) return;
    previewHost.textContent = "";
    previewHost.className = "zt-phud";
    previewHost.hidden = false;
    clearTimeout(state.hideTimer);
    if (previewBrowser) previewBrowser.classList.add("is-building");

    const head = el("div", "zt-phud-head");
    dom.phudPct = el("span", "zt-phud-pct", "0%");
    dom.phudStatus = el("span", "zt-phud-status", "解析中");
    head.append(el("span", "zt-phud-title", "BUILD PREVIEW"), dom.phudStatus, dom.phudPct);
    const list = el("div", "zt-phud-blocks");

    state.phud.blocks = buildPreviewBlocks(input).map((block) => {
      const node = el("div", "zt-phud-block");
      node.dataset.state = "pending";
      node.append(el("span", "zt-phud-tag", block.tag), el("span", "zt-phud-check", "✓"));
      const body = el("div", "zt-phud-body");
      const rows = block.rows.map((row) => {
        const rowEl = el("div", `zt-phud-row is-${row.kind}`);
        const text = el("span", "zt-phud-text", "");
        if (row.kind === "menu") {
          rowEl.append(text, el("span", "zt-phud-price", row.price || ""));
        } else {
          rowEl.appendChild(text);
        }
        if (row.kind !== "photo") rowEl.style.setProperty("--w", `${Math.min(100, 30 + (row.text || "").length * 6)}%`);
        body.appendChild(rowEl);
        return { ...row, el: rowEl, textEl: text };
      });
      node.appendChild(body);
      list.appendChild(node);
      return { ...block, el: node, rows };
    });

    const foot = el("div", "zt-phud-foot");
    foot.append(el("span", "", "your-shop.example"), el("span", "zt-phud-foot-live", "rendering…"));
    previewHost.append(el("div", "zt-phud-scan"), el("i", "zt-phud-corner is-tl"), el("i", "zt-phud-corner is-tr"), el("i", "zt-phud-corner is-bl"), el("i", "zt-phud-corner is-br"), head, list, foot);
  };

  const typeRow = (row, done) => {
    if (row.kind === "photo") {
      row.el.classList.add("has-text");
      later(done, 180);
      return;
    }
    if (REDUCED_MOTION) {
      row.textEl.textContent = row.text;
      row.el.classList.add("has-text");
      done();
      return;
    }
    row.el.classList.add("has-text");
    let i = 0;
    const step = () => {
      if (i >= row.text.length) {
        done();
        return;
      }
      i += 1;
      row.textEl.textContent = row.text.slice(0, i);
      later(step, PHUD_ROW_TYPE_MS);
    };
    step();
  };

  const buildBlock = (block) => {
    block.el.dataset.state = "building";
    let r = 0;
    const next = () => {
      if (r >= block.rows.length) {
        block.el.dataset.state = "done";
        return;
      }
      const row = block.rows[r];
      r += 1;
      typeRow(row, next);
    };
    next();
  };

  const phudEnterPhase = (index) => {
    if (!previewHost || !state.phud.blocks.length) return;
    const blocks = state.phud.blocks;
    previewHost.dataset.phase = PHASES[index].id;
    dom.phudStatus.textContent = PHASES[index].ja;
    if (index === 0) {
      blocks.forEach((b, i) => later(() => {
        b.el.classList.add("is-scan");
        later(() => b.el.classList.remove("is-scan"), PHUD_SCAN_STAGGER_MS * 2);
      }, i * PHUD_SCAN_STAGGER_MS));
      return;
    }
    if (index === PHASE_VERIFYING) {
      blocks.forEach((b, i) => later(() => {
        if (b.el.dataset.state !== "done") { // 組み上がる前に検証へ進んだ場合は即時に組む
          b.rows.forEach((row) => {
            if (row.textEl) row.textEl.textContent = row.text || "";
            row.el.classList.add("has-text");
          });
          b.el.dataset.state = "done";
        }
        b.el.classList.add("is-verified");
      }, i * PHUD_VERIFY_STAGGER_MS));
      return;
    }
    if (index === PHASE_DEPLOYING) return;
    blocks.filter((b) => b.phase === index).forEach((b, i) => later(() => buildBlock(b), i * PHUD_BUILD_STAGGER_MS));
  };

  const hidePreviewHud = () => {
    if (!previewHost) return;
    previewHost.classList.add("is-done");
    if (previewBrowser) previewBrowser.classList.remove("is-building");
    clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => {
      previewHost.hidden = true;
      previewHost.classList.remove("is-done");
    }, PHUD_HIDE_MS);
  };

  // ---------- start / stop ----------
  const defaults = {
    shopName: "あなたのお店",
    businessType: "飲食店",
    catchcopy: "ここに、あなたの物語を。",
    description: "お店の特徴を入れると、ここにすぐ反映されます。",
    featureLabel: "おすすめ",
    featureTitle: "本日の定食",
    menu: [],
    phone: "",
    address: "",
    hours: ""
  };

  const start = (input) => {
    if (!root || state.running) return;
    state.running = true;
    state.input = { ...defaults, ...(input || {}) };
    Object.keys(state.input).forEach((k) => {
      if (typeof state.input[k] === "string") state.input[k] = state.input[k].trim();
    });
    state.x = 0;
    state.tools = 0;
    state.agents = 1;
    state.forcedNext = null;
    state.lastLogText = "";
    state.lastStream = "";
    state.progress = 0;
    state.progressTarget = 0;
    state.tps = 0;
    state.ctxTokens = 0;
    state.segments = buildSegments(state.input);
    state.segIndex = 0;
    state.streamLines = buildStreamLines(state.input);
    state.net.last = 0;
    state.net.spawnAt = 0;
    state.net.burst = -1;
    state.inView = true;

    buildConsole();
    buildLanes();
    buildWave();
    buildPreviewHud(state.input);
    resizeNet();
    enterPhase(0);
    tickLanes();
    tickWave();
    tickMetrics();
    scheduleLog();
    typeSegment();
    scheduleStream();
    every(tickLanes, TICK_MS);
    every(tickWave, WAVE_MS);
    every(tickMetrics, METRIC_MS);

    if (!REDUCED_MOTION) state.rafId = requestAnimationFrame(frame);

    state.onVisibility = () => { state.net.last = 0; };
    document.addEventListener("visibilitychange", state.onVisibility);
    if ("ResizeObserver" in window) {
      state.resizeObserver = new ResizeObserver(() => resizeNet());
      state.resizeObserver.observe(root);
    } else {
      state.onResize = () => resizeNet();
      window.addEventListener("resize", state.onResize);
    }
    if ("IntersectionObserver" in window) {
      state.intersection = new IntersectionObserver((entries) => {
        state.inView = entries.some((e) => e.isIntersecting);
      });
      state.intersection.observe(root);
    }
  };

  const stop = () => {
    state.timeouts.forEach((id) => clearTimeout(id));
    state.timeouts.clear();
    state.intervals.forEach((id) => clearInterval(id));
    state.intervals = [];
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    if (state.onVisibility) document.removeEventListener("visibilitychange", state.onVisibility);
    if (state.onResize) window.removeEventListener("resize", state.onResize);
    if (state.resizeObserver) state.resizeObserver.disconnect();
    if (state.intersection) state.intersection.disconnect();
    state.onVisibility = null;
    state.onResize = null;
    state.resizeObserver = null;
    state.intersection = null;
    state.net.signals = [];
    state.running = false;
    hidePreviewHud();
  };

  window.ztConsole = { start, stop };
})();
