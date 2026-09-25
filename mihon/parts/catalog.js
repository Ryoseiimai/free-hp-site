/*
  カタログだけで使う操作（部品には含めない）
  - トーンの切り替え: 舞台（.stage）の data-fhp-tone を付け替える
  - 写真ギャラリーの枚数、予約・問い合わせの時刻、メニューの形を試す
  - お知らせの日付を「開いた日から◯日前」に入れ直す（いつ開いても新着の印が見えるように）
  - data-demo の付いたリンクは移動せず、本番で何が起きるかを一言出す
  - 「コードをコピー」「コードを見る」: <部品>/copy.html（貼るだけで動く1まとまり）を読み込んで使う
  URL の ?tone= ?count= ?now= ?menu= で最初の状態を決められる（撮影・確認用）。
  部品の JS より前（DOMContentLoaded の前）に動くので、日付や枚数は部品が数える前に決まる。
*/
(function () {
  'use strict';

  var TONES = ['aoba', 'genkido', 'soramame'];
  var DAY_MS = 24 * 60 * 60 * 1000;
  var params = new URLSearchParams(location.search);
  var stages = document.querySelectorAll('.stage');

  function radios(name) {
    return Array.prototype.slice.call(document.querySelectorAll('input[name="' + name + '"]'));
  }
  function check(name, value) {
    radios(name).forEach(function (r) { r.checked = r.value === value; });
  }
  function onChange(name, fn) {
    radios(name).forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) fn(r.value); });
    });
  }
  function remember(key, value) {
    var url = new URL(location.href);
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
    history.replaceState(null, '', url);
  }

  // トーン
  function setTone(tone) {
    if (TONES.indexOf(tone) === -1) return;
    stages.forEach(function (s) { s.dataset.fhpTone = tone; });
    check('tone', tone);
  }
  setTone(params.get('tone') || 'aoba');
  onChange('tone', function (v) { setTone(v); remember('tone', v); });

  // 写真ギャラリーの枚数（li を抜き差しする。隠すだけだと部品の枚数の数え方が狂う）
  var grid = document.querySelector('#gallery .fhp-gallery-grid');
  var photos = Array.prototype.slice.call(grid.children);
  function setCount(n) {
    var count = Math.max(3, Math.min(photos.length, Number(n) || 8));
    grid.replaceChildren.apply(grid, photos.slice(0, count));
    check('gallery-count', String(count));
  }
  setCount(params.get('count') || '8');
  onChange('gallery-count', function (v) { setCount(v); remember('count', v); });

  // 予約・問い合わせの時刻
  var contact = document.querySelector('#contact [data-fhp-contact]');
  function setNow(value) {
    if (value) contact.dataset.now = value;
    else delete contact.dataset.now;
    check('contact-now', value);
    contact.dispatchEvent(new Event('fhp:refresh'));
  }
  setNow(params.get('now') || '');
  onChange('contact-now', function (v) { setNow(v); remember('now', v); });

  // メニューの形
  var menu = document.querySelector('#menu [data-fhp-menu]');
  function setMenu(format) {
    var f = format === 'text' ? 'text' : 'photo';
    menu.classList.toggle('fhp-menu--photo', f === 'photo');
    menu.classList.toggle('fhp-menu--text', f === 'text');
    check('menu-format', f);
  }
  setMenu(params.get('menu'));
  onChange('menu-format', function (v) { setMenu(v); remember('menu', v === 'photo' ? '' : v); });

  // お知らせの日付を、日本時間の今日から数えて入れ直す
  var todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
  var today = Date.parse(todayYmd + 'T00:00:00Z');
  document.querySelectorAll('#news [data-days-ago]').forEach(function (li) {
    var d = new Date(today - Number(li.dataset.daysAgo) * DAY_MS);
    var time = li.querySelector('time');
    time.setAttribute('datetime', d.toISOString().slice(0, 10));
    time.textContent = d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日';
  });

  // 見本のリンク
  var DEMO_TEXT = {
    tel: '見本のため、電話はかかりません。本番では、押すとお店に電話がかかります。',
    reserve: '見本のため、予約ページには移動しません。本番では、お店が使っている予約サイトが開きます。',
    line: '見本のため、LINEは開きません。本番では、お店のLINE公式アカウントが開きます。'
  };
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[data-demo]');
    if (!link) return;
    e.preventDefault();
    var msg = link.closest('.stage').querySelector('.stage-msg');
    if (msg) msg.textContent = DEMO_TEXT[link.dataset.channel] || '見本のため、このリンクは移動しません。';
  });

  // コードをコピー／コードを見る
  var COPIED_MS = 4000;
  var codeCache = {};
  function loadCode(name) {
    if (!codeCache[name]) {
      codeCache[name] = fetch(name + '/copy.html').then(function (res) {
        if (!res.ok) throw new Error(res.status);
        return res.text();
      });
    }
    return codeCache[name];
  }
  // クリップボードの API が使えない環境（古いブラウザ・http）では、選択してコピーする昔の方法に切り替える
  function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand('copy');
      area.remove();
      if (ok) resolve();
      else reject(new Error('copy failed'));
    });
  }
  var LOAD_FAILED = 'コードを読み込めませんでした。freehp.jp のページを開き直すか、上の zip をダウンロードしてください。';
  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    var msg = document.getElementById(btn.getAttribute('aria-describedby'));
    var timer = null;
    // 文を <span> に入れて、BudouX で文節の途中の改行を防ぐ
    function say(text) {
      var span = document.createElement('span');
      span.textContent = text;
      msg.replaceChildren(span);
      if (window.insertPhraseBreaks) window.insertPhraseBreaks(msg);
    }
    btn.addEventListener('click', function () {
      loadCode(btn.dataset.copy)
        .then(writeClipboard)
        .then(function () {
          btn.classList.add('is-done');
          say('コピーしました。置きたい場所に貼り付けてください。');
        })
        .catch(function () {
          btn.classList.remove('is-done');
          say('コピーできませんでした。「コードを見る」を開いて、選んでコピーしてください。');
        })
        .then(function () {
          clearTimeout(timer);
          timer = setTimeout(function () { btn.classList.remove('is-done'); }, COPIED_MS);
        });
    });
  });
  document.querySelectorAll('.part-code').forEach(function (box) {
    box.addEventListener('toggle', function () {
      if (!box.open || box.dataset.loaded) return;
      var code = box.querySelector('code');
      loadCode(box.dataset.code)
        .then(function (text) { code.textContent = text; box.dataset.loaded = 'true'; })
        .catch(function () { code.textContent = LOAD_FAILED; });
    });
  });
})();
