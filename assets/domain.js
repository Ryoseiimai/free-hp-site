(() => {
  "use strict";

  const API_BASE = "https://free-hp-engine.ryoseiworld.workers.dev";
  const DOMAIN_REQUEST_URL = `${API_BASE}/api/domain-request`;
  const CONTACT_EMAIL = "info@ryoseiworld.co.jp";
  const STORAGE_KEY = "freehpDomainRequestId";
  const JAPANESE_TEXT_PATTERN = /[぀-ヿ㐀-鿿]/u;

  const form = document.querySelector("#domain-form");
  if (!form) return;

  const submitButton = document.querySelector("#domain-submit");
  const resultPanel = document.querySelector("#domain-result");
  const loadingPanel = document.querySelector("#domain-loading");
  const successPanel = document.querySelector("#domain-success");
  const errorPanel = document.querySelector("#domain-error");
  const receiptId = document.querySelector("#receipt-id");
  const previousReceipt = document.querySelector("#previous-receipt");
  const statusList = document.querySelector("#domain-status-list");
  const nextSteps = document.querySelector("#next-steps");
  const errorMessage = document.querySelector("#domain-error-message");
  const errorContact = document.querySelector("#domain-error-contact");
  let submitting = false;

  const getValue = (name) => {
    const field = form.elements[name];
    if (!field) return "";
    if (field instanceof RadioNodeList) return field.value;
    return typeof field.value === "string" ? field.value.trim() : "";
  };

  const requestedDomain = (labelName, tldName) => {
    const label = getValue(labelName).toLowerCase();
    return label ? `${label}.${getValue(tldName)}` : "";
  };

  const buildPayload = () => ({
    storeName: getValue("storeName"),
    siteUrl: getValue("siteUrl"),
    domains: [
      requestedDomain("domainLabel1", "domainTld1"),
      requestedDomain("domainLabel2", "domainTld2")
    ].filter(Boolean),
    contactName: getValue("contactName"),
    email: getValue("email"),
    phone: getValue("phone"),
    method: getValue("method"),
    note: getValue("note"),
    agree: form.elements.agree.checked
  });

  const applicationText = () => {
    const payload = buildPayload();
    return [
      "独自ドメイン申込のご相談",
      "",
      `お店の名前：${payload.storeName || "未入力"}`,
      `公開中のページ：${payload.siteUrl || "未入力"}`,
      `希望ドメイン：${payload.domains.join("、") || "未入力"}`,
      `お名前：${payload.contactName || "未入力"}`,
      `メール：${payload.email || "未入力"}`,
      `電話：${payload.phone || "未入力"}`,
      `取得方法：${payload.method || "未選択"}`,
      `ご要望：${payload.note || "なし"}`
    ].join("\n");
  };

  const updateContactLink = () => {
    errorContact.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("独自ドメイン申込の相談")}&body=${encodeURIComponent(applicationText())}`;
  };

  const setResultState = (state) => {
    resultPanel.hidden = false;
    loadingPanel.hidden = state !== "loading";
    successPanel.hidden = state !== "success";
    errorPanel.hidden = state !== "error";
    resultPanel.dataset.state = state;
  };

  const validationMessageFor = (detail) => {
    const messages = [
      [/^storeName/u, "お店の名前を1〜60文字で入力してください。"],
      [/^siteUrl/u, "公開中のページURLは https:// から始まるURLを入力してください。"],
      [/^domains|^domain |^each domain/u, "希望ドメインは英小文字・数字・ハイフンだけで入力してください。"],
      [/^contactName/u, "お名前を1〜40文字で入力してください。"],
      [/^email/u, "メールアドレスを確認してください。"],
      [/^phone/u, "電話番号は数字とハイフンだけで入力してください。"],
      [/^method/u, "取得方法を1つ選んでください。"],
      [/^note/u, "ご要望は300文字以内で入力してください。"],
      [/^agree/u, "内容をご確認のうえ、同意欄にチェックしてください。"]
    ];
    const known = messages.find(([pattern]) => pattern.test(detail));
    if (known) return known[1];
    if (JAPANESE_TEXT_PATTERN.test(detail)) return detail;
    return "入力内容を確認して、もう一度お試しください。";
  };

  const errorMessageFor = (status, serverMessage) => {
    const detail = typeof serverMessage === "string" ? serverMessage : "";
    switch (status) {
      case 400:
      case 422:
        return validationMessageFor(detail);
      case 429:
        return detail || "送信回数の上限に達しました。1時間後にもう一度お試しください。";
      case 502:
      case 503:
        return detail || "受付サービスと通信できませんでした。少し時間をおいて、もう一度お試しください。";
      default:
        return JAPANESE_TEXT_PATTERN.test(detail) ? detail : "お申し込みを送信できませんでした。もう一度お試しください。";
    }
  };

  const saveReceipt = (id) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, id);
    } catch {
      // sessionStorageを使えない環境でも、今回の受付結果はそのまま表示する。
    }
  };

  const showPreviousReceipt = () => {
    let id = "";
    try {
      id = sessionStorage.getItem(STORAGE_KEY) || "";
    } catch {
      id = "";
    }
    if (!/^\d{8}-[0-9a-f]{8}$/u.test(id)) return;
    previousReceipt.textContent = `この画面で前回受け付けた番号：${id}`;
    previousReceipt.hidden = false;
  };

  const availabilityLabel = (status) => ({
    available: "空いています",
    taken: "使われています",
    unknown: "確認できませんでした（手動で確認します）"
  })[status] || "確認できませんでした（手動で確認します）";

  const priceLabel = (domain, yen) => {
    const price = Number.isFinite(yen) ? Number(yen).toLocaleString("ja-JP") : "確認中";
    return domain.endsWith(".jp")
      ? `年${price}円（税込・目安）`
      : `年${price}円（税込）`;
  };

  const renderSuccess = (result, requestedDomains) => {
    receiptId.textContent = result.id;
    statusList.replaceChildren();
    requestedDomains.forEach((domain) => {
      const status = result.availability[domain] || "unknown";
      const item = document.createElement("li");
      item.className = `domain-status is-${status}`;
      const name = document.createElement("strong");
      name.textContent = domain;
      const availability = document.createElement("span");
      availability.textContent = availabilityLabel(status);
      const quote = document.createElement("small");
      quote.textContent = `見積：${priceLabel(domain, result.quote[domain])}`;
      item.append(name, availability, quote);
      statusList.appendChild(item);
    });

    nextSteps.replaceChildren();
    result.nextSteps.forEach((step) => {
      const item = document.createElement("li");
      item.textContent = step;
      nextSteps.appendChild(item);
    });
    saveReceipt(result.id);
    showPreviousReceipt();
    setResultState("success");
  };

  const validResult = (result) => result
    && /^\d{8}-[0-9a-f]{8}$/u.test(result.id)
    && result.availability && typeof result.availability === "object"
    && result.quote && typeof result.quote === "object"
    && Array.isArray(result.nextSteps);

  const showError = (message) => {
    errorMessage.textContent = message;
    updateContactLink();
    setResultState("error");
  };

  const submitRequest = async () => {
    if (submitting) return;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const payload = buildPayload();
    submitting = true;
    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
    submitButton.dataset.defaultLabel = submitButton.textContent;
    submitButton.textContent = "空き状況を確認しています…";
    setResultState("loading");

    try {
      const response = await fetch(DOMAIN_REQUEST_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
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
      if (!validResult(result)) {
        showError("受付結果を確認できませんでした。受付状況をメールでお問い合わせください。");
        return;
      }
      renderSuccess(result, payload.domains);
    } catch {
      showError("通信に失敗しました。少し時間をおいて、もう一度お試しいただくか、メールでご相談ください。");
    } finally {
      submitting = false;
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
      submitButton.textContent = submitButton.dataset.defaultLabel || "空き状況を確認して申し込む";
    }
  };

  form.addEventListener("input", updateContactLink);
  form.addEventListener("change", updateContactLink);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitRequest();
  });

  showPreviousReceipt();
  updateContactLink();
})();
