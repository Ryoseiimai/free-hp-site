/*
  予約・問い合わせ: 営業時間内かどうかをページ側で計算して表示し、押してほしいボタンを出し分ける。
  - 時刻はいつも日本時間（Asia/Tokyo）で計算する。海外から見ても店の時刻で判定される
  - data-hours に曜日ごとの営業時間（"9:00-19:00"、昼休みは "11:00-14:00,17:00-22:00"、定休日は ""）
  - data-last-call に「まもなく終了」と出す分数（既定30分）
  - 営業中: 電話を主に。時間外・定休日: 電話ボタンを隠し、ネット予約（なければLINE）を主にする
  - href が空のボタンは最初に取り除く（使わない連絡手段は書かなくてよい）
  - data-now="2026-09-24T10:00" を付けると、その時刻で表示する（見本・確認用）。付け替えたら
    要素に 'fhp:refresh' イベントを送る
*/
(function () {
  'use strict';

  var DAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  var DEFAULT_LAST_CALL_MIN = 30;
  var REFRESH_MS = 60 * 1000;
  var PRIORITY = {
    open: ['tel', 'reserve', 'line'],
    closed: ['reserve', 'line', 'tel']
  };
  var CHANNEL_NAMES = { reserve: 'ネット予約', line: 'LINE' };

  function toMin(hhmm) {
    var p = hhmm.trim().split(':');
    return Number(p[0]) * 60 + Number(p[1] || 0);
  }
  function fmt(min) {
    return Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0');
  }
  function parseRanges(text) {
    if (!text) return [];
    return text.split(',').map(function (r) {
      var p = r.split('-');
      return { start: toMin(p[0]), end: toMin(p[1]) };
    });
  }

  // 日本時間の「曜日」と「0時からの分」
  function tokyoNow(override) {
    if (override) {
      var m = override.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (m) {
        var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return { day: d.getUTCDay(), min: +m[4] * 60 + +m[5] };
      }
    }
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    var get = function (type) { return parts.find(function (p) { return p.type === type; }).value; };
    var dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return { day: dayIndex, min: Number(get('hour')) * 60 + Number(get('minute')) };
  }

  function dayLabel(offset, day) {
    if (offset === 0) return '本日';
    if (offset === 1) return '明日（' + DAYS[day] + '）';
    return DAYS[day] + '曜';
  }

  function findNextOpen(week, now) {
    for (var offset = 0; offset <= 7; offset++) {
      var day = (now.day + offset) % 7;
      var later = week[day].filter(function (r) { return offset > 0 || r.start > now.min; });
      if (later.length) return { offset: offset, day: day, start: later[0].start };
    }
    return null;
  }

  function judge(week, now, lastCall) {
    var today = week[now.day];
    var current = today.find(function (r) { return now.min >= r.start && now.min < r.end; });
    if (current) {
      var left = current.end - now.min;
      var soon = left <= lastCall;
      return {
        state: 'open',
        title: soon ? 'まもなく終了します' : '営業中です',
        detail: '本日 ' + fmt(current.end) + ' まで' + (soon ? '（あと' + left + '分）' : '')
      };
    }
    var next = findNextOpen(week, now);
    var nextText = next ? '次は ' + dayLabel(next.offset, next.day) + ' ' + fmt(next.start) + ' から' : '';
    if (!today.length) return { state: 'closed', title: '本日は定休日です', detail: nextText, next: next };
    var before = now.min < today[0].start;
    return { state: 'closed', title: before ? '開店前です' : '営業時間外です', detail: nextText, next: next };
  }

  function renderWeek(table, week, today) {
    table.innerHTML = '';
    WEEK_ORDER.forEach(function (day) {
      var tr = document.createElement('tr');
      if (day === today) tr.className = 'is-today';
      var th = document.createElement('th');
      th.scope = 'row';
      th.textContent = DAYS[day] + (day === today ? '（今日）' : '');
      var td = document.createElement('td');
      td.textContent = week[day].length
        ? week[day].map(function (r) { return fmt(r.start) + '〜' + fmt(r.end); }).join('、')
        : '定休日';
      tr.appendChild(th);
      tr.appendChild(td);
      table.appendChild(tr);
    });
  }

  function initContact(root) {
    var raw = JSON.parse(root.dataset.hours || '{}');
    var week = DAYS.map(function (d) { return parseRanges(raw[d]); });
    var lastCall = Number(root.dataset.lastCall || DEFAULT_LAST_CALL_MIN);
    var buttons = Array.prototype.slice.call(root.querySelectorAll('[data-channel]'));
    buttons.filter(function (b) { return !b.getAttribute('href'); }).forEach(function (b) { b.remove(); });
    buttons = buttons.filter(function (b) { return b.isConnected; });
    var titleEl = root.querySelector('.fhp-contact-title');
    var detailEl = root.querySelector('.fhp-contact-detail');
    var noteEl = root.querySelector('.fhp-contact-note');
    var noteText = noteEl.querySelector('span') || noteEl;
    var weekEl = root.querySelector('.fhp-contact-week tbody');

    function update() {
      var now = tokyoNow(root.dataset.now);
      var result = judge(week, now, lastCall);
      root.dataset.state = result.state;
      titleEl.textContent = result.title;
      detailEl.textContent = result.detail;

      var order = PRIORITY[result.state];
      var visible = buttons.filter(function (b) {
        var hide = result.state === 'closed' && b.dataset.channel === 'tel';
        b.hidden = hide;
        return !hide;
      });
      visible.sort(function (a, b) { return order.indexOf(a.dataset.channel) - order.indexOf(b.dataset.channel); });
      visible.forEach(function (b, i) {
        b.style.order = String(i);
        b.classList.toggle('fhp-btn--sub', i > 0);
      });

      var hasTel = buttons.some(function (b) { return b.dataset.channel === 'tel'; });
      var anytime = buttons
        .map(function (b) { return CHANNEL_NAMES[b.dataset.channel]; })
        .filter(Boolean);
      noteText.textContent = result.state === 'closed' && hasTel
        ? 'お電話は営業時間内にお願いします。' + (anytime.length ? anytime.join('と') + 'は、時間外でも受け付けています。' : '')
        : '';
      noteEl.hidden = !noteText.textContent;
      // 見本と同じ「文節の途中で改行しない」処理を、書き換えた文にもかける（BudouX を読み込んでいるページのみ）
      if (window.insertPhraseBreaks) {
        window.insertPhraseBreaks(root.querySelector('.fhp-contact-status'));
        window.insertPhraseBreaks(noteEl);
      }
      if (weekEl) renderWeek(weekEl, week, now.day);
    }

    update();
    root.addEventListener('fhp:refresh', update);
    setInterval(function () { if (!root.dataset.now) update(); }, REFRESH_MS);
  }

  function initAll() {
    document.querySelectorAll('[data-fhp-contact]').forEach(initContact);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
})();
