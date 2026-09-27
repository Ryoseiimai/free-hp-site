/* freehp.jp AIと電話で相談（試作）。
   仕組み: 既存チャットと同じワーカーAPI（window.FreehpChatShared.apiBase）の POST /chat を呼び、
   ブラウザの SpeechRecognition(ja-JP) で聞き取り→API→speechSynthesisで読み上げ、を繰り返す。
   会話履歴はこのタブの中だけで保持し、サーバには保存しない（既存チャットと同じくステートレスAPI）。
   意図的な簡略化:
   - 音声の性別・話速などは選ばず、ブラウザ既定の日本語音声(lang=ja-JP)をそのまま使う。
   - SpeechSynthesisVoicesの非同期ロード(onvoiceschanged)は待たず、呼び出し時点で拾えた声のみ使う。
   - 動画相談かどうかの判定はせず、通話中は常にHP申込・動画申込の両方のリンクを表示する。 */
(function () {
  "use strict";

  var GREETING = "3000円ホームページ・Free動画の相談窓口です。どんなお店・どんな動画ですか？";
  var CONSENT_TEXT = "会話はAIが答えます。録音はしません。個人情報は話さないでください。";
  var SITE_FORM_URL = "#site-form";
  var VIDEO_FORM_URL = "https://github.com/Ryoseiimai/freehp-autopilot/issues/new?template=video.yml&labels=video-request";
  var FALLBACK_API_BASE = "https://freehp-chat.kaeru3160.workers.dev";
  var SID_KEY = "freehp_call_sid";
  var MAX_HISTORY = 16;
  var MAX_LEN = 500;

  var messages = [];
  var refs = null;
  var recognition = null;
  var listening = false;
  var busy = false;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function getApiBase() {
    return (window.FreehpChatShared && window.FreehpChatShared.apiBase) || FALLBACK_API_BASE;
  }

  function getSid() {
    try {
      var sid = window.sessionStorage.getItem(SID_KEY);
      if (!sid) {
        sid = "call-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
        window.sessionStorage.setItem(SID_KEY, sid);
      }
      return sid;
    } catch (e) {
      return "call-fallback";
    }
  }

  function isSupported() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) && Boolean(window.speechSynthesis);
  }

  function build() {
    var overlay = el("div", "call-overlay");
    overlay.id = "call-overlay";
    overlay.hidden = true;

    var panel = el("div", "call-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "call-title");

    var header = el("div", "call-header");
    var title = el("span", "call-title", "AIと電話で相談");
    title.id = "call-title";
    var closeBtn = el("button", "call-close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "電話相談を閉じる");
    header.appendChild(title);
    header.appendChild(closeBtn);

    var body = el("div", "call-body");

    var consentView = el("div", "call-consent-view");
    var consentNote = el("p", "call-consent-note", CONSENT_TEXT);
    var startBtn = el("button", "call-start-button", "はじめる");
    startBtn.type = "button";
    consentView.appendChild(consentNote);
    consentView.appendChild(startBtn);

    var unsupportedView = el("div", "call-unsupported");
    unsupportedView.hidden = true;
    var unsupportedText = el("p", "", "このブラウザは音声通話に対応していません。文字チャットをご利用ください。");
    var unsupportedLink = el("button", "call-unsupported-link", "文字チャットに戻る");
    unsupportedLink.type = "button";
    unsupportedView.appendChild(unsupportedText);
    unsupportedView.appendChild(unsupportedLink);

    var activeView = el("div", "call-active-view");
    activeView.hidden = true;
    var status = el("div", "call-status", "はじめるを押すと会話が始まります");
    var caption = el("div", "call-caption", "");
    caption.setAttribute("role", "log");
    caption.setAttribute("aria-live", "polite");
    var log = el("div", "call-log");

    var controls = el("div", "call-controls");
    var micBtn = el("button", "call-mic-button", "話す");
    micBtn.type = "button";
    micBtn.setAttribute("aria-label", "話す");
    var hangupBtn = el("button", "call-hangup-button", "切る");
    hangupBtn.type = "button";
    hangupBtn.setAttribute("aria-label", "通話を終了する");
    controls.appendChild(micBtn);
    controls.appendChild(hangupBtn);

    var links = el("div", "call-links");
    links.hidden = true;
    var siteLink = el("a", "", "ホームページの申込フォームへ");
    siteLink.href = SITE_FORM_URL;
    var videoLink = el("a", "", "Free動画の申込フォームへ");
    videoLink.href = VIDEO_FORM_URL;
    videoLink.target = "_blank";
    videoLink.rel = "noopener";
    links.appendChild(siteLink);
    links.appendChild(videoLink);

    activeView.appendChild(status);
    activeView.appendChild(caption);
    activeView.appendChild(log);
    activeView.appendChild(controls);
    activeView.appendChild(links);

    body.appendChild(consentView);
    body.appendChild(unsupportedView);
    body.appendChild(activeView);

    panel.appendChild(header);
    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    var r = {
      overlay: overlay,
      closeBtn: closeBtn,
      consentView: consentView,
      startBtn: startBtn,
      unsupportedView: unsupportedView,
      unsupportedLink: unsupportedLink,
      activeView: activeView,
      status: status,
      caption: caption,
      log: log,
      micBtn: micBtn,
      hangupBtn: hangupBtn,
      links: links
    };

    r.closeBtn.addEventListener("click", close);
    r.startBtn.addEventListener("click", startCall);
    r.micBtn.addEventListener("click", toggleListening);
    r.hangupBtn.addEventListener("click", close);
    r.unsupportedLink.addEventListener("click", function () {
      close();
      if (window.FreehpChatShared && typeof window.FreehpChatShared.openPanel === "function") {
        window.FreehpChatShared.openPanel();
      }
    });

    return r;
  }

  function setStatus(text, mode) {
    refs.status.textContent = text;
    refs.status.className = "call-status" + (mode ? " is-" + mode : "");
  }

  function setCaption(text) {
    refs.caption.textContent = text;
  }

  function appendLog(role, text) {
    var line = el("div", "call-log-line " + (role === "user" ? "is-user" : "is-bot"), text);
    refs.log.appendChild(line);
    refs.log.scrollTop = refs.log.scrollHeight;
  }

  function pickJapaneseVoice() {
    if (!window.speechSynthesis) return null;
    var voices = window.speechSynthesis.getVoices() || [];
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].lang && voices[i].lang.indexOf("ja") === 0) return voices[i];
    }
    return null;
  }

  var currentUtterance = null;

  // ユーザーが話し始める・通話を切る等で読み上げを中断するときに使う。
  // speechSynthesis.cancel()は中断でもonend/onerrorを非同期に発火させるため、
  // 先にハンドラを外してから止め、中断後の状態表示が読み上げ完了時のコールバックに
  // 上書きされる（例: 「どうぞお話しください」が直後に「マイクを押して」に戻る）事故を防ぐ。
  function stopSpeaking() {
    if (currentUtterance) {
      currentUtterance.onend = null;
      currentUtterance.onerror = null;
      currentUtterance = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function speak(text, onDone) {
    if (!text || !window.speechSynthesis) {
      onDone();
      return;
    }
    stopSpeaking();
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    var voice = pickJapaneseVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = onDone;
    utterance.onerror = onDone;
    currentUtterance = utterance;
    setStatus("AIが話しています", "speaking");
    window.speechSynthesis.speak(utterance);
  }

  function startCall() {
    refs.consentView.hidden = true;
    refs.activeView.hidden = false;
    refs.links.hidden = true;
    messages = [];
    appendLog("bot", GREETING);
    setCaption(GREETING);
    messages.push({ role: "assistant", content: GREETING });
    speak(GREETING, function () {
      setStatus("マイクのボタンを押して話してください", "");
    });
  }

  function sendUserText(text) {
    if (busy) return;
    var trimmed = String(text).trim().slice(0, MAX_LEN);
    if (!trimmed) {
      setStatus("マイクのボタンを押して話してください", "");
      return;
    }

    appendLog("user", trimmed);
    messages.push({ role: "user", content: trimmed });
    if (messages.length > MAX_HISTORY) {
      messages = messages.slice(messages.length - MAX_HISTORY);
    }

    busy = true;
    refs.micBtn.disabled = true;
    setStatus("考えています…", "");

    fetch(getApiBase() + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid: getSid(), messages: messages })
    })
      .then(function (res) {
        if (res.status === 429) {
          setCaption("少し時間をおいてお試しください。");
          return null;
        }
        if (!res.ok) throw new Error("http-" + res.status);
        return res.json();
      })
      .then(function (data) {
        busy = false;
        refs.micBtn.disabled = false;
        if (!data) {
          setStatus("マイクのボタンを押して話してください", "");
          return;
        }
        if (data.reply) {
          appendLog("bot", data.reply);
          setCaption(data.reply);
          messages.push({ role: "assistant", content: data.reply });
        }
        if (data.done && window.FreehpChatShared && window.FreehpChatShared.fillSiteForm(data.extracted)) {
          refs.links.hidden = false;
        }
        speak(data.reply, function () {
          setStatus("マイクのボタンを押して話してください", "");
        });
      })
      .catch(function () {
        busy = false;
        refs.micBtn.disabled = false;
        setCaption("うまく繋がりませんでした。文字チャットをご利用ください。");
        setStatus("マイクのボタンを押して話してください", "");
      });
  }

  function setupRecognition() {
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    var rec = new Ctor();
    rec.lang = "ja-JP";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = function (event) {
      var text = "";
      for (var i = event.resultIndex; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      setCaption(text);
      var last = event.results[event.results.length - 1];
      if (last && last.isFinal) {
        listening = false;
        refs.micBtn.classList.remove("is-listening");
        refs.micBtn.textContent = "話す";
        sendUserText(text);
      }
    };

    rec.onerror = function (event) {
      listening = false;
      refs.micBtn.classList.remove("is-listening");
      refs.micBtn.textContent = "話す";
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setCaption("マイクの使用が許可されていません。ブラウザの設定をご確認ください。");
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        setCaption("聞き取りに失敗しました。もう一度お試しください。");
      }
      setStatus("マイクのボタンを押して話してください", "");
    };

    rec.onend = function () {
      if (!listening) return;
      listening = false;
      refs.micBtn.classList.remove("is-listening");
      refs.micBtn.textContent = "話す";
      setStatus("マイクのボタンを押して話してください", "");
    };

    return rec;
  }

  function toggleListening() {
    if (busy) return;
    if (listening) {
      recognition.stop();
      return;
    }
    stopSpeaking();
    listening = true;
    refs.micBtn.classList.add("is-listening");
    refs.micBtn.textContent = "聞いています…";
    setStatus("どうぞお話しください", "listening");
    setCaption("");
    try {
      recognition.start();
    } catch (e) {
      // 直前の認識セッションが終わりきっていない等。ユーザーに押し直しを促す（エラーは握りつぶさずログに残す）。
      console.error("freehp call: recognition.start failed", e);
      listening = false;
      refs.micBtn.classList.remove("is-listening");
      refs.micBtn.textContent = "話す";
      setStatus("うまく開始できませんでした。もう一度押してください", "");
    }
  }

  function open() {
    if (!refs) refs = build();
    refs.overlay.hidden = false;
    refs.links.hidden = true;

    if (!isSupported()) {
      refs.consentView.hidden = true;
      refs.unsupportedView.hidden = false;
      refs.activeView.hidden = true;
      return;
    }

    refs.unsupportedView.hidden = true;
    refs.consentView.hidden = false;
    refs.activeView.hidden = true;
    if (!recognition) recognition = setupRecognition();
  }

  function close() {
    if (listening && recognition) recognition.abort();
    stopSpeaking();
    listening = false;
    busy = false;
    if (refs) refs.overlay.hidden = true;
  }

  window.FreehpCall = {
    open: open,
    // 疑似テスト用フック: SpeechRecognitionを経由せず、認識結果が確定した体で直接APIを叩く。
    // 本番のUI操作では使わない（音声入力は自動テストしにくいため用意した検証用の入口）。
    _debugSendText: function (text) {
      if (!refs) refs = build();
      sendUserText(text);
    }
  };
})();
