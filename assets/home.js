(() => {
  "use strict";

  // このファイルは見た目の演出だけを担当する。assets/app.js の input/change
  // リスナー（LIVE PREVIEW反映・送信処理）はいっさい触らず、別のリスナーを
  // 追加するだけにする（SPEC.md: app.jsは無改変で読み込む）。

  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) root.classList.add("reduced-motion");

  /* ---------- 1. 見出しの1文字ずつ立ち上がり ---------- */
  const CHAR_STEP_MS = 26;

  const splitChars = (node, counter) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        Array.from(child.textContent).forEach((ch) => {
          const span = document.createElement("span");
          span.className = "char";
          span.style.animationDelay = `${counter.i * CHAR_STEP_MS}ms`;
          span.textContent = ch === " " ? " " : ch;
          frag.appendChild(span);
          counter.i += 1;
        });
        node.replaceChild(frag, child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        splitChars(child, counter);
      }
    });
  };

  if (!reducedMotion) {
    const heroTitle = document.querySelector("[data-split-title]");
    if (heroTitle) splitChars(heroTitle, { i: 0 });
  }

  /* ---------- 2. スクロールで要素が出現する ---------- */
  const revealTargets = document.querySelectorAll("[data-reveal], [data-reveal-stagger]");
  const STAGGER_STEP_MS = 90;
  const staggerGroups = new Map(); // 親要素ごとの出現順カウンタ

  const assignStaggerDelay = (el) => {
    const group = el.closest(".gallery-grid, .pricing-grid, .steps-list") || el.parentElement;
    const count = staggerGroups.get(group) || 0;
    el.style.transitionDelay = `${Math.min(count, 6) * STAGGER_STEP_MS}ms`;
    staggerGroups.set(group, count + 1);
  };

  if (reducedMotion) {
    revealTargets.forEach((el) => el.classList.add("is-in"));
  } else {
    revealTargets.forEach((el) => {
      if (el.hasAttribute("data-reveal-stagger")) assignStaggerDelay(el);
    });
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.15 }
    );
    revealTargets.forEach((el) => revealObserver.observe(el));
  }

  /* ---------- 3. 数字のカウントアップ ---------- */
  // 2026-08-26: 本番から data-count-to 要素（旧「155件」カウンター）を撤去した。
  // querySelectorAll は対象0件でも空のNodeListを返すため、以下は自然に何もしない
  // （data-count-toを使う要素が復活した場合のために処理自体は残す）。
  const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
  const COUNT_DURATION_MS = 1300;

  const runCounter = (el) => {
    const target = Number(el.dataset.countTo || "0");
    const valueEl = el.querySelector("[data-count-value]") || el;
    if (reducedMotion) {
      valueEl.textContent = String(target);
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / COUNT_DURATION_MS);
      valueEl.textContent = String(Math.round(target * easeOutCubic(progress)));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const counterTargets = document.querySelectorAll("[data-count-to]");
  const counterObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        runCounter(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.4 }
  );
  counterTargets.forEach((el) => counterObserver.observe(el));

  /* ---------- 4. スクロールで背景の紺が微変化する ---------- */
  if (!reducedMotion) {
    const hexToRgb = (hex) => {
      const value = hex.replace("#", "");
      return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
    };
    const rgbToCss = (rgb) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    const lerp = (a, b, t) => a + (b - a) * t;
    const lerpRgb = (a, b, t) => a.map((channel, i) => Math.round(lerp(channel, b[i], t)));

    const stops = ["#141F3A", "#0A1122", "#05060D"].map(hexToRgb);

    const colorForProgress = (progress) => {
      const scaled = progress * (stops.length - 1);
      const index = Math.min(stops.length - 2, Math.floor(scaled));
      const localT = scaled - index;
      return rgbToCss(lerpRgb(stops[index], stops[index + 1], localT));
    };

    let ticking = false;
    const updateScrollState = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      root.style.setProperty("--bg-color", colorForProgress(progress));
      ticking = false;
    };
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(updateScrollState);
      },
      { passive: true }
    );
    updateScrollState();
  }

  /* ---------- 5. 申込フォームの段階表示（入力状態で駆動） ---------- */
  const form = document.querySelector("#site-form");
  if (form) {
    const shopNameInput = document.querySelector("#shop-name");
    const descriptionInput = document.querySelector("#description");
    const stepType = form.querySelector('[data-step="type"]');
    const stepDescription = form.querySelector('[data-step="description"]');
    const stepRest = form.querySelector('[data-step="rest"]');
    const businessRadios = form.querySelectorAll('input[name="businessType"]');
    const previewCol = document.querySelector(".preview-col");
    const allSteps = form.querySelectorAll(".form-step");

    // 未表示の段は hidden + inert（対応ブラウザ）+ 中の入力を disabled にして、
    // タブ順・スクリーンリーダーのツリーから確実に外す（見た目はmax-height/opacityの
    // CSSトランジションが担当するので、ここではアクセシビリティ面だけを扱う）。
    const setStepInteractive = (step, interactive) => {
      step.querySelectorAll("input, textarea, select, button").forEach((el) => {
        el.disabled = !interactive;
      });
    };

    allSteps.forEach((step) => {
      if (!step.classList.contains("is-revealed")) {
        step.hidden = true;
        step.inert = true;
        setStepInteractive(step, false);
      }
    });

    const reveal = (el) => {
      if (!el || el.classList.contains("is-revealed")) return;
      el.hidden = false;
      el.inert = false;
      setStepInteractive(el, true);
      void el.offsetWidth; // hidden解除とis-revealed付与の間に1フレーム挟み、max-heightトランジションを発火させる
      el.classList.add("is-revealed");
    };

    if (shopNameInput && stepType) {
      shopNameInput.addEventListener("input", () => {
        if (shopNameInput.value.trim().length >= 1) reveal(stepType);
      });
      if (shopNameInput.value.trim().length >= 1) reveal(stepType);
    }

    // ラジオは「選ぶと」の体験を優先し、change（値の変化）ではなくclickで
    // 次の段を出す。デフォルト値をそのまま選んでも "選んだ" ことにするため。
    if (stepDescription) {
      businessRadios.forEach((radio) => {
        radio.addEventListener("click", () => reveal(stepDescription));
      });
    }

    if (descriptionInput && stepRest) {
      descriptionInput.addEventListener("input", () => {
        if (descriptionInput.value.trim().length >= 1) reveal(stepRest);
      });
      if (descriptionInput.value.trim().length >= 1) reveal(stepRest);
    }

    const syncPreviewPlaceholder = () => {
      if (!shopNameInput || !previewCol) return;
      previewCol.classList.toggle("has-content", shopNameInput.value.trim().length > 0);
    };
    if (shopNameInput && previewCol) {
      shopNameInput.addEventListener("input", syncPreviewPlaceholder);
      syncPreviewPlaceholder();
    }

    // 戻る（bfcache復元）や、ブラウザの「reload時に入力値を復元する」機能は
    // input イベントを介さずに値だけを戻すことがあるため、pageshow のたびに
    // 現在値から表示状態を再計算する。businessTypeは常にデフォルトでchecked
    // されているため、typeの段が（=お店の名前が入っていて）表示済みの場合に
    // 限ってチェック状態を「選んだ」とみなす（通常の初回読み込みでいきなり
    // descriptionまで出てしまわないようにするため）。
    window.addEventListener("pageshow", () => {
      if (shopNameInput && shopNameInput.value.trim().length >= 1) reveal(stepType);
      if (stepType && !stepType.hidden && form.querySelector('input[name="businessType"]:checked')) reveal(stepDescription);
      if (descriptionInput && descriptionInput.value.trim().length >= 1) reveal(stepRest);
      syncPreviewPlaceholder();
    });

    // 段階表示のフォームは全ステップが同じ<form>内にあるため、単行の
    // テキスト系inputでEnterを押すとネイティブの暗黙送信が働いてしまう。
    // 暗黙送信の対象になりうる単行テキスト系input（text/tel/url/email/search）
    // だけを対象にし、日本語入力の変換確定Enter（isComposing / keyCode 229）と
    // summary・file・button・textarea は素通しする。
    const IMPLICIT_SUBMIT_INPUT_TYPES = ["text", "tel", "url", "email", "search"];
    form.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
      const target = event.target;
      if (target.tagName !== "INPUT" || !IMPLICIT_SUBMIT_INPUT_TYPES.includes(target.type)) return;
      event.preventDefault();
    });
  }

  /* ---------- 6. 送信前チェック：未ログインならログイン欄へ誘導 ---------- */
  // Googleログインが有効な設定（meta[google-client-id]が空でない）のときだけ、
  // 未ログインでの送信をここで止めてログイン欄へ案内する。app.jsのsubmitリスナー
  // （bubbleフェーズ・app.js先読込のため登録順は先）より先に動く必要があるため、
  // 同じ<form>にcaptureフェーズで登録する。同一要素上ではcapture/bubbleの区別が
  // 実行順を決める（captureが先）ため、登録順に関わらずここが先に走る。
  if (form) {
    const SIGNIN_HIGHLIGHT_MS = 2000;
    const NOT_SIGNED_IN_MESSAGE = "先にGoogleでログインしてください（3秒で終わります）";
    const googleClientIdMeta = document.querySelector('meta[name="google-client-id"]');
    const googleClientId = (googleClientIdMeta && googleClientIdMeta.content) || "";
    const signinArea = document.querySelector("#signin-area");
    const signinStatus = document.querySelector("#signin-status");

    form.addEventListener(
      "submit",
      (event) => {
        if (!googleClientId || !signinArea) return; // ログイン欄が無い設定なら従来どおり素通り
        // ログイン済み、またはGoogleの読み込み自体に失敗しているときはここで止めない。
        // 失敗時はapp.js側の案内文とsignin-reloadリンクに委ね、送信自体はapp.jsに任せる。
        if (signinArea.dataset.state === "signed-in" || signinArea.dataset.state === "error") return;

        event.preventDefault();
        event.stopImmediatePropagation();

        signinArea.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
        signinArea.classList.remove("needs-signin");
        void signinArea.offsetWidth; // 再アニメーションのためリフローを挟む
        signinArea.classList.add("needs-signin");
        window.setTimeout(() => signinArea.classList.remove("needs-signin"), SIGNIN_HIGHLIGHT_MS);

        if (signinStatus) signinStatus.textContent = NOT_SIGNED_IN_MESSAGE;
      },
      true
    );

    /* ---------- 7. Googleログイン読み込み失敗時の再読み込みリンク ---------- */
    // signin-area[data-state]はapp.jsが更新するため、MutationObserverで変化を拾う。
    const signinReload = document.querySelector("#signin-reload");
    if (signinReload) {
      const syncSigninReloadVisibility = () => {
        signinReload.hidden = signinArea.dataset.state !== "error";
      };
      syncSigninReloadVisibility();
      new MutationObserver(syncSigninReloadVisibility).observe(signinArea, {
        attributes: true,
        attributeFilter: ["data-state"]
      });
      signinReload.addEventListener("click", () => window.location.reload());
    }
  }
})();
