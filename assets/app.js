(() => {
  "use strict";

  const API_URL = "https://free-hp-engine.ryoseiworld.workers.dev/api/generate";
  const EXPECTED_WORKER_ORIGIN = "https://free-hp-engine.ryoseiworld.workers.dev";
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
    "その他": preview.querySelector('[data-type-block="other"]')
  };
  const moodColors = {
    "あたたかい": "var(--preview-warm)",
    "落ち着いた": "var(--preview-calm)",
    "さわやか": "var(--preview-fresh)"
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

  // クライアントIDが空のあいだはログイン欄を出さず、これまでどおり誰でも作れる。
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
      badgeChoice: "つけたまま（無料）",
      photo: photoDataUri ? "あり（メールに添付してください）" : "なし"
    };
    return [
      "無料ホームページ申込（自動生成がうまくいかない場合）",
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
    manualContactLink.href = `mailto:info@ryoseiworld.co.jp?subject=${encodeURIComponent("無料ホームページの相談")}&body=${encodeURIComponent(buildApplicationText())}`;
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
    generationStatus.textContent = "ホームページができました";
    generatedCopyStatus.textContent = "";
    setGenerationState("success");
  };

  const submitGeneration = async () => {
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    applyButton.disabled = true;
    applyButton.setAttribute("aria-busy", "true");
    applyButton.dataset.defaultLabel = applyButton.textContent;
    applyButton.textContent = "ホームページを作っています…";
    generationStatus.textContent = "ホームページを生成しています…";
    setGenerationState("loading");

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
      showError("通信に失敗しました。少し時間をおいて、もう一度お試しください。");
    } finally {
      applyButton.disabled = false;
      applyButton.removeAttribute("aria-busy");
      applyButton.textContent = applyButton.dataset.defaultLabel || "このホームページを、無料でもらう →";
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
