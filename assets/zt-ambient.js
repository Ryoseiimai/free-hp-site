/*
  zt-ambient — 常時稼働の演出（生成していない時も「AIが裏で動いている」ように見せる）

  担当:
    1. ヘッダー右上の LIVE + 経過時間（このページを開いてからの時間。偽の稼働日数は出さない）
    2. ヒーロー背景のデータ空間 canvas（ノード網・走る信号・マウス反応・時々バースト）
    3. ヒーロー上端の稼働ストリップ（今の工程・店名・tokens/s 等）と右下の readout
    4. 「いまの見本」のデモリール（架空店の見本が組み上がって→完成→次の店、を静かにループ）
    5. セクションのスキャン出現・見出しのデコード・料金のカウントアップ・ダッシュボードの微動
    6. ページ全体を時々走る光（DOMを置くだけ。動きは CSS）

  見た目だけ。実データは一切持たない。店名は index.html「つくった見本」の架空店のみ。
  手渡し: 店名を入力し始めたらデモリールを止めて通常のLIVE PREVIEWへ、生成開始（ztConsole.start）で
  本番演出（assets/zt-console.js）へ譲り、終了後に店名が空ならデモへ戻る。
  意図的な簡略化: 数値（tokens/s・agents・latency）はすべて演出用の乱数。実測に繋ぐなら engine.* を
  サーバの進捗イベントで上書きする形にする。
*/
(() => {
  "use strict";

  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MOBILE_MAX_WIDTH = 560;
  const READOUT_MIN_WIDTH = 900;
  const DPR_MAX = 2;

  // ---------- 架空店（index.html「つくった見本」と同じ店名。実在店・実データは使わない） ----------
  const DEMO_SHOPS = [
    { shopName: "喫茶みなも", slug: "minamo", businessType: "飲食店", catchcopy: "川べりで、ゆっくり一杯。", description: "自家焙煎の豆と手づくりのプリン。窓の外は、川の音。", featureLabel: "おすすめ", featureTitle: "みなもブレンド", menu: [{ name: "ブレンド", price: "480円" }, { name: "プリン", price: "420円" }], hours: "8:00〜18:00（火曜定休）" },
    { shopName: "そらまめ珈琲", slug: "soramame", businessType: "飲食店", catchcopy: "豆から選ぶ、朝の一杯。", description: "駅前の小さな焙煎所。豆の量り売りと、テイクアウトのラテ。", featureLabel: "おすすめ", featureTitle: "本日の豆 3種", menu: [{ name: "ラテ", price: "520円" }, { name: "豆 100g", price: "780円" }], hours: "7:30〜19:00（無休）" },
    { shopName: "hair atelier tsumugi", slug: "tsumugi", businessType: "美容・サロン", catchcopy: "髪を、ていねいに紡ぐ。", description: "席は2つだけ。ひとりひとりに時間をかける小さなサロンです。", featureLabel: "ご予約", featureTitle: "カット ＋ 頭皮ケア", menu: [{ name: "カット", price: "5,500円" }, { name: "カラー", price: "8,800円" }], hours: "10:00〜19:00（月曜定休）" },
    { shopName: "やまだ整体院", slug: "yamada", businessType: "その他", catchcopy: "その痛み、話してください。", description: "肩・腰・膝。まず30分、体の話を聞くところから始めます。", featureLabel: "施術", featureTitle: "初回カウンセリング 30分", menu: [{ name: "整体 60分", price: "6,000円" }], hours: "9:00〜20:00（日曜定休）" },
    { shopName: "ひなた英会話", slug: "hinata", businessType: "教室・スクール", catchcopy: "話せる楽しさ、はじめの一歩。", description: "子どもから大人まで。少人数で、間違えても笑って続けられる教室。", featureLabel: "レッスン", featureTitle: "体験レッスン 無料", menu: [{ name: "月4回", price: "8,000円" }], hours: "14:00〜21:00（土日は10:00〜）" },
    { shopName: "まちの自転車屋 ワタナベ", slug: "watanabe", businessType: "修理・住まいのサービス", catchcopy: "パンク修理、その場で直します。", description: "修理・点検・中古車の販売。持ち込みは予約なしで大丈夫です。", featureLabel: "サービス", featureTitle: "パンク修理 15分", menu: [{ name: "パンク修理", price: "1,200円" }, { name: "点検", price: "2,000円" }], hours: "10:00〜19:00（水曜定休）" }
  ];

  // 工程（zt-console.js と同じ5工程）。pct=表示%の目標、tps=tokens/s の揺れ幅
  const PHASES = {
    reading: { ja: "お店の情報を読み込んでいます", pct: 15, tps: [280, 620], agents: 1 },
    composing: { ja: "文章を書いています", pct: 45, tps: [1700, 2600], agents: 3 },
    building: { ja: "ページを組み立てています", pct: 78, tps: [1100, 1900], agents: 6 },
    verifying: { ja: "仕上がりを確認しています", pct: 92, tps: [400, 900], agents: 4 },
    deploying: { ja: "見本を公開しています", pct: 99, tps: [150, 420], agents: 2 },
    done: { ja: "見本ができました", pct: 100, tps: [60, 140], agents: 1 },
    standby: { ja: "入力を待っています", pct: 0, tps: [40, 120], agents: 1 }
  };

  const ENGINE_TICK_MS = 150;
  const UPTIME_TICK_MS = 1000;
  const PCT_EASE = 0.14;
  const TPS_EASE = 0.3;
  const LATENCY_RANGE = [18, 95];
  const LATENCY_SPIKE_CHANCE = 0.05;
  const LATENCY_SPIKE_MS = 140;

  const DEMO_SCAN_MS = 900;
  const DEMO_SCAN_STAGGER_MS = 220;
  const DEMO_BLOCK_STAGGER_MS = 260;
  const DEMO_ROW_TYPE_MS = 22;
  const DEMO_PHOTO_MS = 200;
  const DEMO_VERIFY_STAGGER_MS = 240;
  const DEMO_VERIFY_HOLD_MS = 700;
  const DEMO_DEPLOY_MS = 1100;
  const DEMO_DONE_HOLD_MS = 2200;
  const DEMO_SWAP_MS = 380;
  const DEMO_RESUME_AFTER_LIVE_MS = 900; // zt-console.js の hidePreviewHud(720ms) が終わってから戻す
  const DEMO_POLL_MS = 500;              // chat.js が input イベントなしで店名を入れる場合に備えた監視
  const DEMO_CLIP_DESC = 60;

  const NET_NODES_DESKTOP = 64;
  const NET_NODES_MOBILE = 26;
  const NET_LINK_DIST_DESKTOP = 170;
  const NET_LINK_DIST_MOBILE = 120;
  const NET_LINKS_PER_NODE = 3;
  const NET_RIGHT_BIAS = 0.7;            // ノードの7割を右側6割の領域に置く（左は文字の可読性を優先）
  const NET_RIGHT_FROM = 0.4;
  const NET_WOBBLE_PX = 4;
  const NET_SIGNAL_MS = [520, 1150];
  const NET_SPAWN_MS = [160, 460];
  const NET_SIGNAL_CONTINUE = 0.86;
  const NET_SIGNAL_BRANCH = 0.18;
  const NET_MAX_SIGNALS = 36;
  const NET_ENERGY_DECAY_MS = 900;
  const NET_BURST_EVERY_MS = [6000, 12000];
  const NET_BURST_MS = 1400;
  const NET_BURST_SIGNALS = 7;
  const NET_MOUSE_RADIUS = 190;
  const NET_MOUSE_PULL = 0.12;
  const NET_MOUSE_SPAWN_MS = 380;
  const NET_SCAN_PERIOD_MS = 9000;
  const NET_MAX_DT = 50;
  const NET_MOBILE_MIN_DT = 30;          // スマホは約30fpsに落とす

  const READOUT_MS = 160;
  const READOUT_HEX_BYTES = 10;

  const COUNT_MS = 1100;
  const DECODE_STEP_MS = 22;
  const DECODE_MAX_CHARS = 40;

  const WATCHER_LIVE_MS = [2200, 5200];
  const WATCHER_TODAY_MS = [6000, 14000];
  const WATCHER_TAP_MS = [18000, 40000];
  const WATCHER_LIVE_RANGE = [1, 6];
  const WATCHER_SPARK_BARS = 28;
  const WATCHER_SPARK_MS = 900;

  const TICKER_ITEMS = [
    "hero-section.html ✓", "menu-section.html ✓", "photo → webp q=82 ✓", "fonts/ZenKaku.woff2 HIT",
    "contrast 6.2:1 ✓", "mobile 375px ✓", "tel: link ✓", "map link ✓", "og:image 1200×630 ✓",
    "sitemap.xml ✓", "deploy → edge ✓", "cache warming…", "見本URLを発行", "次の店へ →"
  ];

  const rand = ([min, max]) => min + Math.random() * (max - min);
  const randInt = (range) => Math.round(rand(range));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const pad2 = (n) => String(n).padStart(2, "0");
  const clip = (text, max) => (text && text.length > max ? `${text.slice(0, max - 1)}…` : text || "");
  const fmtInt = (n) => Math.round(n).toLocaleString("en-US");
  const isMobile = () => window.innerWidth <= MOBILE_MAX_WIDTH;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ---------- 共有状態（ストリップ・readout・デモが同じ「今の仕事」を見る） ----------
  const engine = {
    mode: "demo",       // demo | input | live
    name: DEMO_SHOPS[0].shopName,
    phase: "reading",
    pctTarget: 0,
    pct: 0,
    tps: 0,
    agents: 1,
    latency: 0,
    ctx: 0
  };
  const stats = { frames: 0, costMs: 0 };

  const shopInput = document.querySelector("#shop-name");
  const form = document.querySelector("#site-form");
  const shopNameValue = () => (shopInput ? shopInput.value.trim() : "");

  const setJob = (mode, name, phase) => {
    engine.mode = mode;
    engine.name = name;
    engine.phase = phase;
    engine.pctTarget = PHASES[phase].pct;
  };

  /* ====================================================================
     1. ヘッダー LIVE + 経過時間
     ==================================================================== */
  const uptimeEl = document.querySelector("#zt-header-uptime");
  const startedAt = Date.now();
  const tickUptime = () => {
    if (!uptimeEl) return;
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    uptimeEl.textContent = h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  };
  tickUptime();
  setInterval(tickUptime, UPTIME_TICK_MS);

  /* ====================================================================
     2. ヒーロー背景 canvas（データ空間）
     ==================================================================== */
  const hero = document.querySelector("#hero");
  const canvas = document.querySelector("#zt-hero-net");
  const net = { nodes: [], edges: [], signals: [], w: 0, h: 0, dpr: 1, last: 0, spawnAt: 0, burstAt: 0, burst: -1, burstX: 0, burstY: 0, mx: -1, my: -1, mouseSpawnAt: 0, rafId: 0, inView: true, running: false };

  const buildNodes = () => {
    const count = isMobile() ? NET_NODES_MOBILE : NET_NODES_DESKTOP;
    const linkDist = isMobile() ? NET_LINK_DIST_MOBILE : NET_LINK_DIST_DESKTOP;
    net.nodes = [];
    net.edges = [];
    net.signals = [];
    for (let i = 0; i < count; i += 1) {
      const right = Math.random() < NET_RIGHT_BIAS;
      const x = right ? net.w * (NET_RIGHT_FROM + Math.random() * (1 - NET_RIGHT_FROM)) : net.w * Math.random();
      const y = net.h * (0.06 + Math.random() * 0.88);
      net.nodes.push({ bx: x, by: y, x, y, energy: 0, seed: Math.random() * Math.PI * 2, edges: [] });
    }
    const seen = new Set();
    net.nodes.forEach((a, i) => {
      const near = net.nodes
        .map((b, j) => ({ b, j, d: Math.hypot(a.bx - b.bx, a.by - b.by) }))
        .filter((o) => o.j !== i && o.d < linkDist)
        .sort((p, q) => p.d - q.d)
        .slice(0, NET_LINKS_PER_NODE);
      near.forEach(({ b, j }) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) return;
        seen.add(key);
        const edge = { a, b };
        net.edges.push(edge);
        a.edges.push(edge);
        b.edges.push(edge);
      });
    });
  };

  const resizeNet = () => {
    if (!canvas || !hero) return;
    const rect = hero.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    net.dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    net.w = rect.width;
    net.h = rect.height;
    canvas.width = Math.round(net.w * net.dpr);
    canvas.height = Math.round(net.h * net.dpr);
    buildNodes();
    if (REDUCED_MOTION) {
      net.nodes.forEach((n) => { n.energy = Math.random() < 0.2 ? 0.6 : 0; });
      drawNet(0);
    }
  };

  const spawnSignal = (from) => {
    if (net.signals.length >= NET_MAX_SIGNALS) return;
    const source = from || pick(net.nodes);
    if (!source || !source.edges.length) return;
    const edge = pick(source.edges);
    source.energy = Math.max(source.energy, 0.7);
    net.signals.push({ edge, from: source, to: edge.a === source ? edge.b : edge.a, t: 0, ms: rand(NET_SIGNAL_MS) });
  };

  const netBurst = (node) => {
    const origin = node || pick(net.nodes);
    if (!origin) return;
    net.burst = 0;
    net.burstX = origin.x;
    net.burstY = origin.y;
    origin.energy = 1;
    for (let i = 0; i < NET_BURST_SIGNALS; i += 1) spawnSignal(origin);
  };

  const stepNet = (dt, ts) => {
    const decay = dt / NET_ENERGY_DECAY_MS;
    const hasMouse = net.mx >= 0;
    net.nodes.forEach((n) => {
      n.energy = Math.max(0, n.energy - decay);
      let x = n.bx + Math.sin(ts * 0.0006 + n.seed) * NET_WOBBLE_PX;
      let y = n.by + Math.cos(ts * 0.0005 + n.seed) * NET_WOBBLE_PX;
      if (hasMouse) {
        const dx = net.mx - x;
        const dy = net.my - y;
        const d = Math.hypot(dx, dy);
        if (d < NET_MOUSE_RADIUS) {
          const k = 1 - d / NET_MOUSE_RADIUS;
          x += dx * k * NET_MOUSE_PULL;
          y += dy * k * NET_MOUSE_PULL;
          n.energy = Math.max(n.energy, k * 0.45);
        }
      }
      n.x = x;
      n.y = y;
    });
    const arrived = [];
    net.signals = net.signals.filter((s) => {
      s.t += dt / s.ms;
      if (s.t < 1) return true;
      arrived.push(s.to);
      return false;
    });
    arrived.forEach((node) => {
      node.energy = 1;
      if (Math.random() < NET_SIGNAL_CONTINUE) spawnSignal(node);
      if (Math.random() < NET_SIGNAL_BRANCH) spawnSignal(node);
    });
    if (ts >= net.spawnAt) {
      spawnSignal();
      net.spawnAt = ts + rand(NET_SPAWN_MS);
    }
    if (hasMouse && ts >= net.mouseSpawnAt) {
      let nearest = null;
      let best = NET_MOUSE_RADIUS;
      net.nodes.forEach((n) => {
        const d = Math.hypot(net.mx - n.x, net.my - n.y);
        if (d < best) { best = d; nearest = n; }
      });
      if (nearest) spawnSignal(nearest);
      net.mouseSpawnAt = ts + NET_MOUSE_SPAWN_MS;
    }
    if (net.burst >= 0) {
      net.burst += dt / NET_BURST_MS;
      if (net.burst >= 1) net.burst = -1;
    } else if (ts >= net.burstAt) {
      netBurst();
      net.burstAt = ts + rand(NET_BURST_EVERY_MS);
    }
  };

  const drawNet = (ts) => {
    const ctx = canvas.getContext("2d");
    if (!ctx || !net.w) return;
    ctx.setTransform(net.dpr, 0, 0, net.dpr, 0, 0);
    ctx.clearRect(0, 0, net.w, net.h);

    // ゆっくり降りる走査線
    const scanY = ((ts % NET_SCAN_PERIOD_MS) / NET_SCAN_PERIOD_MS) * net.h;
    const scan = ctx.createLinearGradient(0, scanY - 60, 0, scanY);
    scan.addColorStop(0, "rgba(79, 209, 232, 0)");
    scan.addColorStop(1, "rgba(79, 209, 232, .07)");
    ctx.fillStyle = scan;
    ctx.fillRect(0, scanY - 60, net.w, 60);

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(245, 241, 228, .09)";
    ctx.beginPath();
    net.edges.forEach(({ a, b }) => {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    });
    ctx.stroke();

    ctx.lineWidth = 1.4;
    net.signals.forEach((s) => {
      const { from, to, t } = s;
      const t0 = Math.max(0, t - 0.18);
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const x0 = from.x + (to.x - from.x) * t0;
      const y0 = from.y + (to.y - from.y) * t0;
      const grad = ctx.createLinearGradient(x0, y0, x, y);
      grad.addColorStop(0, "rgba(79, 209, 232, 0)");
      grad.addColorStop(1, "rgba(79, 209, 232, .8)");
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(79, 209, 232, .22)";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#DFFBFF";
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    });

    net.nodes.forEach((n) => {
      const e = n.energy;
      if (e > 0.02) {
        ctx.fillStyle = "#4FD1E8";
        ctx.globalAlpha = e * 0.22;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 3 + e * 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = e > 0.05 ? "#4FD1E8" : "rgba(245, 241, 228, .5)";
      ctx.globalAlpha = 0.45 + e * 0.55;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 1.8 + e * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (e > 0.15) {
        ctx.strokeStyle = `rgba(79, 209, 232, ${e * 0.5})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 6 + e * 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    if (net.burst >= 0) {
      const k = net.burst;
      const radius = 40 + Math.max(net.w, net.h) * 0.45 * k;
      ctx.strokeStyle = `rgba(79, 209, 232, ${(1 - k) * 0.45})`;
      ctx.lineWidth = 1.5 - k;
      ctx.beginPath();
      ctx.arc(net.burstX, net.burstY, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  };

  const frame = (ts) => {
    if (!net.running) return;
    if (!net.last) net.last = ts;
    const elapsed = ts - net.last;
    if (isMobile() && elapsed > 0 && elapsed < NET_MOBILE_MIN_DT) { // スマホは描画を間引く（約30fps）
      net.rafId = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(NET_MAX_DT, elapsed || 16);
    net.last = ts;
    const t0 = performance.now();
    stepNet(dt, ts);
    drawNet(ts);
    stats.frames += 1;
    stats.costMs += performance.now() - t0;
    net.rafId = requestAnimationFrame(frame);
  };

  const startNet = () => {
    if (net.running || REDUCED_MOTION || !net.inView || document.hidden) return;
    net.running = true;
    net.last = 0;
    net.rafId = requestAnimationFrame(frame);
  };
  const stopNet = () => {
    net.running = false;
    cancelAnimationFrame(net.rafId);
    net.rafId = 0;
  };

  if (canvas && hero) {
    resizeNet();
    if ("ResizeObserver" in window) {
      new ResizeObserver(() => resizeNet()).observe(hero);
    } else {
      window.addEventListener("resize", resizeNet);
    }
    hero.addEventListener("pointermove", (event) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      const rect = hero.getBoundingClientRect();
      net.mx = event.clientX - rect.left;
      net.my = event.clientY - rect.top;
    }, { passive: true });
    hero.addEventListener("pointerleave", () => { net.mx = -1; net.my = -1; });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        net.inView = entries.some((e) => e.isIntersecting);
        if (net.inView) startNet(); else stopNet();
      }).observe(hero);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopNet(); else startNet();
    });
    startNet();
  }

  /* ====================================================================
     3. 稼働ストリップ + readout
     ==================================================================== */
  const strip = {
    phase: document.querySelector("#zt-strip-phase"),
    name: document.querySelector("#zt-strip-name"),
    pct: document.querySelector("#zt-strip-pct"),
    tps: document.querySelector("#zt-strip-tps"),
    agents: document.querySelector("#zt-strip-agents"),
    lat: document.querySelector("#zt-strip-lat"),
    ticker: document.querySelector("#zt-strip-ticker")
  };
  const readout = document.querySelector("#zt-readout");
  const readoutLines = [];

  if (strip.ticker) {
    const text = TICKER_ITEMS.join("   ·   ");
    strip.ticker.textContent = `${text}   ·   ${text}   ·   `;
  }

  if (readout) {
    for (let i = 0; i < 6; i += 1) {
      const line = el("span", "hero-readout-line");
      readout.appendChild(line);
      readoutLines.push(line);
    }
  }

  const bar = (fill, len) => "▮".repeat(Math.round(fill * len)) + "▯".repeat(len - Math.round(fill * len));
  const hexRow = () => Array.from({ length: READOUT_HEX_BYTES }, () => Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, "0")).join(" ");

  let readoutSkip = 0;
  const tickEngine = () => {
    const phase = PHASES[engine.phase] || PHASES.standby;
    engine.tps += (rand(phase.tps) - engine.tps) * TPS_EASE;
    engine.agents = phase.agents;
    engine.latency = Math.random() < LATENCY_SPIKE_CHANCE ? LATENCY_SPIKE_MS : rand(LATENCY_RANGE);
    engine.ctx += engine.tps * (ENGINE_TICK_MS / 1000);
    if (engine.mode === "live") {
      // 本番演出の進捗%（zt-console.js が右カラムに書く値）をそのまま映す
      const livePct = document.querySelector("#zt-preview-hud .zt-phud-pct");
      const n = livePct ? parseInt(livePct.textContent, 10) : NaN;
      if (!Number.isNaN(n)) engine.pctTarget = n;
    }
    engine.pct += (engine.pctTarget - engine.pct) * PCT_EASE;
    if (engine.pctTarget === 0) engine.pct = 0;
    const pct = Math.round(engine.pct);

    if (strip.phase) strip.phase.textContent = engine.phase;
    if (strip.name) strip.name.textContent = engine.name || "—";
    if (strip.pct) strip.pct.textContent = `${pct}%`;
    if (strip.tps) strip.tps.textContent = fmtInt(engine.tps);
    if (strip.agents) strip.agents.textContent = String(engine.agents);
    if (strip.lat) strip.lat.textContent = `${Math.round(engine.latency)}ms`;

    if (!readoutLines.length || !net.inView || window.innerWidth < READOUT_MIN_WIDTH) return;
    readoutSkip = (readoutSkip + 1) % Math.max(1, Math.round(READOUT_MS / ENGINE_TICK_MS));
    if (readoutSkip !== 0) return;
    const ctxK = engine.ctx >= 1000 ? `${(engine.ctx / 1000).toFixed(1)}k` : String(Math.round(engine.ctx));
    const hot = engine.tps / 2600;
    readoutLines[0].textContent = `engine demo · job ${engine.name} · ${engine.phase} ${pct}%`;
    readoutLines[1].textContent = `tok    ${fmtInt(engine.tps)}/s   ctx ${ctxK}`;
    readoutLines[2].textContent = `agent  main ${bar(Math.min(1, hot + 0.2), 6)}  sub·1 ${bar(Math.random() * hot, 4)}  sub·2 ${bar(Math.random() * hot, 4)}`;
    readoutLines[3].textContent = `lat    ${Math.round(engine.latency)}ms   cache ${Math.random() < 0.85 ? "HIT" : "MISS"}`;
    readoutLines[4].textContent = `mem    ${hexRow()}`;
    readoutLines[5].textContent = `check  html ✓  375px ✓  contrast ✓  tel: ✓`;
  };
  tickEngine();
  if (!REDUCED_MOTION) setInterval(tickEngine, ENGINE_TICK_MS);

  /* ====================================================================
     4. 「いまの見本」デモリール（架空店の見本が組み上がる → 完成 → 次の店）
     CSSは zt-console.js の .zt-phud 系をそのまま使う（見た目を本番演出と揃えるため）
     ==================================================================== */
  const previewHost = document.querySelector("#zt-preview-hud");
  const previewBrowser = previewHost ? previewHost.closest(".mini-browser") : null;
  const previewAddress = previewBrowser ? previewBrowser.querySelector(".browser-address") : null;
  const PREVIEW_ADDRESS_DEFAULT = previewAddress ? previewAddress.textContent : "";
  const demo = { running: false, live: false, timeouts: new Set(), shopIndex: 0, blocks: [], status: null, inView: true, pollId: 0 };

  const later = (fn, ms) => {
    const id = setTimeout(() => {
      demo.timeouts.delete(id);
      if (demo.running) fn();
    }, ms);
    demo.timeouts.add(id);
  };
  const clearLater = () => {
    demo.timeouts.forEach((id) => clearTimeout(id));
    demo.timeouts.clear();
  };

  const demoBlocks = (shop) => [
    { tag: "header", phase: "composing", rows: [{ kind: "title", text: shop.shopName }] },
    { tag: "hero", phase: "composing", rows: [{ kind: "kicker", text: shop.businessType }, { kind: "h", text: shop.catchcopy }, { kind: "photo" }] },
    { tag: "about", phase: "building", rows: [{ kind: "p", text: clip(shop.description, DEMO_CLIP_DESC) }] },
    { tag: "feature", phase: "building", rows: [{ kind: "label", text: shop.featureLabel }, { kind: "strong", text: shop.featureTitle }] },
    { tag: "menu", phase: "building", rows: shop.menu.map((m) => ({ kind: "menu", text: m.name, price: m.price })) },
    // access ブロックは枠の高さ（.mini-browser は sample-site の高さで決まる）に収まらないので、1行に圧縮して menu に続ける
    { tag: "access", phase: "building", rows: [{ kind: "small", text: `営業 ${shop.hours} · 電話 · 地図` }] }
  ];

  const buildDemoHud = (shop) => {
    previewHost.textContent = "";
    previewHost.className = "zt-phud is-demo";
    previewHost.dataset.phase = "reading";
    previewHost.hidden = false;
    if (previewBrowser) previewBrowser.classList.add("is-building");
    if (previewAddress) previewAddress.textContent = `${shop.slug}.example`;

    const head = el("div", "zt-phud-head");
    demo.status = el("span", "zt-phud-status", PHASES.reading.ja);
    demo.pct = el("span", "zt-phud-pct", "0%");
    head.append(el("span", "zt-phud-title", "ENGINE DEMO"), demo.status, demo.pct);
    const list = el("div", "zt-phud-blocks");
    demo.blocks = demoBlocks(shop).map((block) => {
      const node = el("div", "zt-phud-block");
      node.dataset.state = "pending";
      node.append(el("span", "zt-phud-tag", block.tag), el("span", "zt-phud-check", "✓"));
      const body = el("div", "zt-phud-body");
      const rows = block.rows.map((row) => {
        const rowEl = el("div", `zt-phud-row is-${row.kind}`);
        const text = el("span", "zt-phud-text", "");
        if (row.kind === "menu") rowEl.append(text, el("span", "zt-phud-price", row.price || ""));
        else rowEl.appendChild(text);
        if (row.kind !== "photo") rowEl.style.setProperty("--w", `${Math.min(100, 30 + (row.text || "").length * 6)}%`);
        body.appendChild(rowEl);
        return { ...row, el: rowEl, textEl: text };
      });
      node.appendChild(body);
      list.appendChild(node);
      return { ...block, el: node, rows };
    });
    const stamp = el("div", "zt-phud-stamp", "DONE ✓");
    const foot = el("div", "zt-phud-foot");
    foot.append(el("span", "zt-phud-demo-note", "架空のお店で試運転中"), el("span", "zt-phud-foot-live", "rendering…"));
    previewHost.append(el("div", "zt-phud-scan"), el("i", "zt-phud-corner is-tl"), el("i", "zt-phud-corner is-tr"), el("i", "zt-phud-corner is-bl"), el("i", "zt-phud-corner is-br"), head, list, stamp, foot);
  };

  const setDemoPhase = (phase) => {
    previewHost.dataset.phase = phase;
    demo.status.textContent = PHASES[phase].ja;
    setJob("demo", DEMO_SHOPS[demo.shopIndex].shopName, phase);
  };

  const typeRow = (row, done) => {
    row.el.classList.add("has-text");
    if (row.kind === "photo") { later(done, DEMO_PHOTO_MS); return; }
    let i = 0;
    const step = () => {
      if (i >= row.text.length) { done(); return; }
      i += 1;
      row.textEl.textContent = row.text.slice(0, i);
      later(step, DEMO_ROW_TYPE_MS);
    };
    step();
  };

  const buildBlock = (block, done) => {
    block.el.dataset.state = "building";
    let r = 0;
    const next = () => {
      if (r >= block.rows.length) {
        block.el.dataset.state = "done";
        later(done, DEMO_BLOCK_STAGGER_MS);
        return;
      }
      typeRow(block.rows[r], next);
      r += 1;
    };
    next();
  };

  const buildBlocksOfPhase = (phase, done) => {
    const targets = demo.blocks.filter((b) => b.phase === phase);
    let i = 0;
    const next = () => {
      if (i >= targets.length) { done(); return; }
      const block = targets[i];
      i += 1;
      buildBlock(block, next);
    };
    next();
  };

  const runDemoCycle = () => {
    if (!demo.running) return;
    const shop = DEMO_SHOPS[demo.shopIndex];
    buildDemoHud(shop);
    setDemoPhase("reading");
    demo.blocks.forEach((b, i) => later(() => {
      b.el.classList.add("is-scan");
      later(() => b.el.classList.remove("is-scan"), DEMO_SCAN_STAGGER_MS * 2);
    }, i * DEMO_SCAN_STAGGER_MS));

    later(() => {
      setDemoPhase("composing");
      buildBlocksOfPhase("composing", () => {
        setDemoPhase("building");
        buildBlocksOfPhase("building", () => {
          setDemoPhase("verifying");
          demo.blocks.forEach((b, i) => later(() => b.el.classList.add("is-verified"), i * DEMO_VERIFY_STAGGER_MS));
          later(() => {
            setDemoPhase("deploying");
            later(() => {
              setDemoPhase("done");
              previewHost.classList.add("is-complete");
              const footLive = previewHost.querySelector(".zt-phud-foot-live");
              if (footLive) footLive.textContent = "published ✓";
              later(() => {
                previewHost.classList.add("is-swap");
                later(nextShop, DEMO_SWAP_MS);
              }, DEMO_DONE_HOLD_MS);
            }, DEMO_DEPLOY_MS);
          }, demo.blocks.length * DEMO_VERIFY_STAGGER_MS + DEMO_VERIFY_HOLD_MS);
        });
      });
    }, DEMO_SCAN_MS);
  };

  const nextShop = () => {
    demo.shopIndex = (demo.shopIndex + 1) % DEMO_SHOPS.length;
    if (!demo.inView || document.hidden) { // 見えていない間は次の店へ進まない（CPUを使わない）
      later(nextShop, DEMO_POLL_MS);
      return;
    }
    runDemoCycle();
  };

  const stopDemo = () => {
    if (!demo.running) return;
    demo.running = false;
    clearLater();
    clearInterval(demo.pollId);
    demo.pollId = 0;
    previewHost.hidden = true;
    previewHost.className = "zt-phud";
    previewHost.textContent = "";
    if (previewBrowser) previewBrowser.classList.remove("is-building");
    if (previewAddress) previewAddress.textContent = PREVIEW_ADDRESS_DEFAULT;
  };

  const renderStaticDemo = () => { // reduced-motion: 動かさず「組み上がった状態」を1枚だけ見せる
    buildDemoHud(DEMO_SHOPS[0]);
    demo.blocks.forEach((b) => {
      b.rows.forEach((row) => {
        if (row.textEl) row.textEl.textContent = row.text || "";
        row.el.classList.add("has-text");
      });
      b.el.dataset.state = "done";
      b.el.classList.add("is-verified");
    });
    demo.status.textContent = PHASES.done.ja;
    demo.pct.textContent = "100%";
    previewHost.dataset.phase = "done";
    previewHost.classList.add("is-complete");
    previewHost.querySelector(".zt-phud-foot-live").textContent = "published ✓";
  };

  const startDemo = () => {
    if (!previewHost || demo.running || demo.live || shopNameValue()) return;
    if (REDUCED_MOTION) {
      renderStaticDemo();
      setJob("demo", DEMO_SHOPS[0].shopName, "done");
      return;
    }
    demo.running = true;
    demo.pollId = setInterval(() => { if (shopNameValue()) syncDemoToInput(); }, DEMO_POLL_MS);
    runDemoCycle();
  };

  // 店名の有無で「デモ」⇄「入力」を切り替える（生成中は触らない）
  const syncDemoToInput = () => {
    if (demo.live) return;
    const name = shopNameValue();
    if (name) {
      stopDemo();
      setJob("input", name, "reading");
      engine.pctTarget = Math.round(PHASES.reading.pct * Math.min(1, name.length / 6));
      return;
    }
    if (!demo.running) {
      if (REDUCED_MOTION) previewHost.hidden = false;
      startDemo();
    }
  };

  if (previewHost) {
    // デモ内の pct はストリップと同じ値を映す
    if (!REDUCED_MOTION) setInterval(() => { if (demo.pct && demo.running) demo.pct.textContent = `${Math.round(engine.pct)}%`; }, ENGINE_TICK_MS);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => { demo.inView = entries.some((e) => e.isIntersecting); }).observe(previewHost.parentElement);
    }
    if (shopInput) shopInput.addEventListener("input", syncDemoToInput);
    if (form) form.addEventListener("focusin", syncDemoToInput);
    window.addEventListener("pageshow", syncDemoToInput);

    // 本番演出（zt-console.js）への手渡し。app.js は呼ぶたびに window.ztConsole を引くので差し替えが効く
    const original = window.ztConsole;
    if (original) {
      window.ztConsole = {
        start: (input) => {
          stopDemo();
          demo.live = true;
          const name = (input && input.shopName) || shopNameValue() || "あなたのお店";
          setJob("live", name, "building");
          original.start(input);
        },
        stop: () => {
          original.stop();
          demo.live = false;
          setJob("input", shopNameValue() || engine.name, "done");
          setTimeout(syncDemoToInput, DEMO_RESUME_AFTER_LIVE_MS);
        }
      };
    }
    syncDemoToInput();
  }

  /* ====================================================================
     5. セクションのスキャン出現・見出しデコード・料金カウントアップ・ダッシュボード微動
     ==================================================================== */
  const sections = Array.from(document.querySelectorAll("main > section:not(#hero), main > nav.guide-links"));

  const decodeTitle = (title) => {
    if (REDUCED_MOTION || title.dataset.decoded) return;
    title.dataset.decoded = "1";
    const text = title.textContent;
    if (!text || text.length > DECODE_MAX_CHARS) return;
    title.textContent = "";
    Array.from(text).forEach((ch, i) => {
      const span = el("span", "zt-decode-char", ch);
      span.style.animationDelay = `${i * DECODE_STEP_MS}ms`;
      title.appendChild(span);
    });
  };

  const animateCount = (span) => {
    const target = Number(span.dataset.target || "0");
    if (REDUCED_MOTION || target === 0) { span.textContent = fmtInt(target); return; }
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / COUNT_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      span.textContent = fmtInt(target * eased);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  document.querySelectorAll(".pricing-figure").forEach((figure) => {
    const text = figure.textContent;
    const match = /([0-9][0-9,]*)/u.exec(text);
    if (!match) return;
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    const span = el("span", "zt-num", "0");
    span.dataset.target = match[0].replace(/,/gu, "");
    figure.textContent = "";
    figure.append(document.createTextNode(before), span, document.createTextNode(after));
  });

  sections.forEach((section) => section.classList.add("zt-scan"));
  if (REDUCED_MOTION) {
    sections.forEach((section) => section.classList.add("is-scanned"));
    document.querySelectorAll(".zt-num").forEach(animateCount);
  } else if ("IntersectionObserver" in window) {
    const scanObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const section = entry.target;
        section.classList.add("is-scanned");
        section.querySelectorAll(".section-title-lg, .section-title-mid").forEach(decodeTitle);
        section.querySelectorAll(".zt-num").forEach(animateCount);
        observer.unobserve(section);
      });
    }, { threshold: 0.12 });
    sections.forEach((section) => scanObserver.observe(section));
  } else {
    sections.forEach((section) => section.classList.add("is-scanned"));
  }

  // ダッシュボード：数字が静かに動く + スパークライン
  const watcher = document.querySelector(".watcher-dashboard");
  if (watcher && !REDUCED_MOTION) {
    const liveNum = watcher.querySelector(".watcher-live-num");
    const values = watcher.querySelectorAll(".watcher-card-value");
    const todayEl = values[0];
    const tapEl = values[1];
    const spark = el("div", "watcher-spark");
    const bars = Array.from({ length: WATCHER_SPARK_BARS }, () => {
      const b = el("i", "");
      b.style.height = `${20 + Math.random() * 60}%`;
      spark.appendChild(b);
      return b;
    });
    watcher.appendChild(spark);
    let inView = false;
    const bump = (node, delta, range) => {
      const next = Math.max(range ? range[0] : 0, Math.min(range ? range[1] : Infinity, Number(node.textContent) + delta));
      if (String(next) === node.textContent) return;
      node.textContent = String(next);
      node.classList.remove("is-bump");
      void node.offsetWidth;
      node.classList.add("is-bump");
    };
    const loop = (fn, range) => {
      const run = () => {
        if (inView && !document.hidden) fn();
        setTimeout(run, rand(range));
      };
      setTimeout(run, rand(range));
    };
    if (liveNum) loop(() => bump(liveNum, Math.random() < 0.5 ? -1 : 1, WATCHER_LIVE_RANGE), WATCHER_LIVE_MS);
    if (todayEl) loop(() => bump(todayEl, 1), WATCHER_TODAY_MS);
    if (tapEl) loop(() => bump(tapEl, 1), WATCHER_TAP_MS);
    loop(() => {
      const heights = bars.map((b) => b.style.height);
      heights.shift();
      const prev = parseFloat(heights[heights.length - 1]) || 40;
      heights.push(`${Math.max(8, Math.min(100, prev * 0.5 + (10 + Math.random() * 70) * 0.5))}%`);
      bars.forEach((b, i) => { b.style.height = heights[i]; });
    }, [WATCHER_SPARK_MS, WATCHER_SPARK_MS]);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => { inView = entries.some((e) => e.isIntersecting); }).observe(watcher);
    } else {
      inView = true;
    }
  }

  /* ====================================================================
     6. ページ全体を時々走る光（CSSアニメーション。要素を置くだけ）
     ==================================================================== */
  if (!REDUCED_MOTION) {
    document.body.append(el("div", "zt-beam is-v"), el("div", "zt-beam is-h"));
  }

  window.ztAmbient = {
    stats: () => ({ frames: stats.frames, avgFrameMs: stats.frames ? stats.costMs / stats.frames : 0, signals: net.signals.length, nodes: net.nodes.length, edges: net.edges.length }),
    engine
  };
})();
