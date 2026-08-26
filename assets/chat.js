/* freehp.jp チャット窓口。
   仕様: 右下ボタン→開くとパネル。会話はワーカーAPI（window.FREEHP_CHAT_API）に POST /chat する。
   意図的な簡略化: APIが未デプロイの間はエラー表示のみ確認可能（本格運用時は FREEHP_CHAT_API を実URLに差し替える）。 */
(function () {
  "use strict";

  var API_BASE = window.FREEHP_CHAT_API || "https://freehp-chat.kaeru3160.workers.dev";
  var GREETED_KEY = "freehp_chat_greeted";
  var SID_KEY = "freehp_chat_sid";
  var MAX_HISTORY = 16;
  var MAX_LEN = 500;
  var GREET_DELAY_MS = 3000;

  var messages = [];
  var sending = false;
  var opened = false;

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function getSid() {
    try {
      var sid = window.sessionStorage.getItem(SID_KEY);
      if (!sid) {
        sid = "s-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
        window.sessionStorage.setItem(SID_KEY, sid);
      }
      return sid;
    } catch (e) {
      return "s-fallback";
    }
  }

  function shouldGreetToday() {
    try {
      return window.localStorage.getItem(GREETED_KEY) !== todayKey();
    } catch (e) {
      return true;
    }
  }

  function markGreetedToday() {
    try {
      window.localStorage.setItem(GREETED_KEY, todayKey());
    } catch (e) {
      /* localStorage不可でも致命的ではないので無視 */
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function build() {
    var launcher = el("div", "chat-launcher");
    launcher.id = "chat-launcher";

    var bubble = el("div", "chat-launcher-bubble", "お店のホームページ、翌日にお届けします。どんなお店ですか？");
    bubble.id = "chat-greet-bubble";
    bubble.hidden = true;

    var button = el("button", "chat-launcher-button", "話す");
    button.type = "button";
    button.id = "chat-launcher-button";
    button.setAttribute("aria-label", "AIチャット窓口を開く");
    button.setAttribute("aria-haspopup", "dialog");

    launcher.appendChild(bubble);
    launcher.appendChild(button);

    var panel = el("div", "chat-panel");
    panel.id = "chat-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-labelledby", "chat-panel-title");
    panel.hidden = true;

    var header = el("div", "chat-panel-header");
    var title = el("span", "chat-panel-title", "AIチャット窓口");
    title.id = "chat-panel-title";
    var closeBtn = el("button", "chat-panel-close", "×");
    closeBtn.type = "button";
    closeBtn.id = "chat-panel-close";
    closeBtn.setAttribute("aria-label", "チャットを閉じる");
    header.appendChild(title);
    header.appendChild(closeBtn);

    var messagesEl = el("div", "chat-panel-messages");
    messagesEl.id = "chat-panel-messages";
    messagesEl.setAttribute("role", "log");
    messagesEl.setAttribute("aria-live", "polite");

    var form = el("form", "chat-panel-form");
    form.id = "chat-panel-form";
    var input = el("input", "chat-panel-input");
    input.type = "text";
    input.id = "chat-panel-input";
    input.setAttribute("maxlength", String(MAX_LEN));
    input.setAttribute("aria-label", "メッセージを入力");
    input.placeholder = "メッセージを入力";
    var sendBtn = el("button", "chat-panel-send", "送信");
    sendBtn.type = "submit";
    sendBtn.id = "chat-panel-send";
    form.appendChild(input);
    form.appendChild(sendBtn);

    var note = el("div", "chat-panel-note", "入力内容はホームページ作成にだけ使います。");

    panel.appendChild(header);
    panel.appendChild(messagesEl);
    panel.appendChild(form);
    panel.appendChild(note);

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    return {
      launcher: launcher,
      bubble: bubble,
      button: button,
      panel: panel,
      closeBtn: closeBtn,
      messagesEl: messagesEl,
      form: form,
      input: input,
      sendBtn: sendBtn
    };
  }

  function appendMessage(refs, role, text) {
    var cls = role === "user" ? "chat-message chat-message-user"
      : role === "error" ? "chat-message chat-message-error"
      : "chat-message chat-message-bot";
    var node = el("div", cls);
    node.textContent = text;
    refs.messagesEl.appendChild(node);
    refs.messagesEl.scrollTop = refs.messagesEl.scrollHeight;
    return node;
  }

  function appendErrorWithLink(refs) {
    var node = el("div", "chat-message chat-message-error");
    node.appendChild(document.createTextNode("うまく繋がりませんでした。下のフォームから直接どうぞ "));
    var link = el("a", "", "フォームへ");
    link.href = "#site-form";
    node.appendChild(link);
    refs.messagesEl.appendChild(node);
    refs.messagesEl.scrollTop = refs.messagesEl.scrollHeight;
  }

  function openPanel(refs) {
    opened = true;
    refs.panel.hidden = false;
    refs.bubble.hidden = true;
    if (refs.messagesEl.children.length === 0) {
      appendMessage(refs, "bot", "お店のホームページ、翌日にお届けします。どんなお店ですか？");
      messages.push({ role: "assistant", content: "お店のホームページ、翌日にお届けします。どんなお店ですか？" });
    }
    window.setTimeout(function () {
      refs.input.focus();
    }, 0);
    document.addEventListener("keydown", refs._escHandler);
  }

  function closePanel(refs) {
    opened = false;
    refs.panel.hidden = true;
    refs.button.focus();
  }

  // フォーム欄の対応表:
  //   extracted.shop      -> #shop-name (name="shopName")
  //   extracted.industry  -> input[name="businessType"] のうち value が一致するもの
  //   extracted.area      -> 直接一致する欄が無いため、最も近い #address (name="address") に入れる
  var FIELD_MAP = {
    shop: { id: "shop-name" },
    industry: { radioName: "businessType" },
    area: { id: "address" }
  };

  var PANEL_CLOSE_DELAY_MS = 1500;

  function applyExtracted(refs, extracted) {
    if (!extracted || typeof extracted !== "object") return;
    var form = document.getElementById("site-form");
    if (!form) return;

    var unmatchedNote = null;

    if (extracted.shop) {
      var shopInput = document.getElementById(FIELD_MAP.shop.id);
      if (shopInput) shopInput.value = extracted.shop;
    }

    if (extracted.industry) {
      var radios = form.querySelectorAll('input[name="' + FIELD_MAP.industry.radioName + '"]');
      var matched = false;
      for (var i = 0; i < radios.length; i++) {
        if (radios[i].value === extracted.industry) {
          radios[i].checked = true;
          matched = true;
          break;
        }
      }
      if (!matched) {
        unmatchedNote = (unmatchedNote ? unmatchedNote + " / " : "") + "業種（チャットの回答）: " + extracted.industry;
      }
    }

    if (extracted.area) {
      var addressInput = document.getElementById(FIELD_MAP.area.id);
      if (addressInput && !addressInput.value) {
        addressInput.value = extracted.area;
      } else {
        unmatchedNote = (unmatchedNote ? unmatchedNote + " / " : "") + "地域（チャットの回答）: " + extracted.area;
      }
    }

    if (unmatchedNote) {
      var existing = document.getElementById("chat-extracted-note");
      if (!existing) {
        existing = el("p", "chat-extracted-note");
        existing.id = "chat-extracted-note";
        existing.style.fontSize = "12px";
        existing.style.marginBottom = "8px";
        form.parentNode.insertBefore(existing, form);
      }
      existing.textContent = unmatchedNote;
    }

    appendMessage(refs, "bot", "下のフォームに入れておきました。内容をご確認のうえ送信してください。");
    messages.push({ role: "assistant", content: "下のフォームに入れておきました。内容をご確認のうえ送信してください。" });

    window.setTimeout(function () {
      closePanel(refs);
    }, PANEL_CLOSE_DELAY_MS);

    form.scrollIntoView({ behavior: "smooth", block: "start" });

    var focusTargets = ["shop-name", "description", "phone", "address"];
    for (var j = 0; j < focusTargets.length; j++) {
      var target = document.getElementById(focusTargets[j]);
      if (target && !target.value) {
        window.setTimeout(function (t) {
          return function () { t.focus(); };
        }(target), 400);
        break;
      }
    }
  }

  function sendMessage(refs, text) {
    if (sending) return;
    var trimmed = text.trim().slice(0, MAX_LEN);
    if (!trimmed) return;

    appendMessage(refs, "user", trimmed);
    messages.push({ role: "user", content: trimmed });
    if (messages.length > MAX_HISTORY) {
      messages = messages.slice(messages.length - MAX_HISTORY);
    }

    sending = true;
    refs.input.disabled = true;
    refs.sendBtn.disabled = true;
    refs.input.value = "";

    var payload = { sid: getSid(), messages: messages };

    fetch(API_BASE + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (res.status === 429) {
          appendMessage(refs, "error", "少し時間をおいてお試しください");
          return null;
        }
        if (!res.ok) {
          throw new Error("http-" + res.status);
        }
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        if (data.reply) {
          appendMessage(refs, "bot", data.reply);
          messages.push({ role: "assistant", content: data.reply });
        }
        if (data.done) {
          applyExtracted(refs, data.extracted);
        }
      })
      .catch(function () {
        appendErrorWithLink(refs);
      })
      .finally(function () {
        sending = false;
        refs.input.disabled = false;
        refs.sendBtn.disabled = false;
        refs.input.focus();
      });
  }

  function init() {
    var refs = build();

    refs._escHandler = function (e) {
      if (e.key === "Escape" && opened) {
        closePanel(refs);
      }
    };

    refs.button.addEventListener("click", function () {
      if (refs.panel.hidden) {
        openPanel(refs);
      } else {
        closePanel(refs);
      }
    });

    refs.closeBtn.addEventListener("click", function () {
      closePanel(refs);
    });

    refs.form.addEventListener("submit", function (e) {
      e.preventDefault();
      sendMessage(refs, refs.input.value);
    });

    if (shouldGreetToday()) {
      window.setTimeout(function () {
        if (!opened) {
          refs.bubble.hidden = false;
          markGreetedToday();
        }
      }, GREET_DELAY_MS);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
