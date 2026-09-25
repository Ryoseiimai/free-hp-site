/*
  お知らせ: 日付つきの一覧。新しいものに「新着」の印を付け、古いものは畳む。
  - 各項目の <time datetime="YYYY-MM-DD"> を見て、新しい順に並べ直す（書く順番を間違えても崩れない）
  - data-new-days（既定14）日以内のものに「新着」を付ける。今日の日付は日本時間で数える
  - data-show（既定4）件より多いときは残りを畳み、「過去のお知らせを見る」ボタンで開く
*/
(function () {
  'use strict';

  var DEFAULT_NEW_DAYS = 14;
  var DEFAULT_SHOW = 4;
  var DAY_MS = 24 * 60 * 60 * 1000;

  // 日本時間の今日（0時）を UTC の日付として返す。datetime="YYYY-MM-DD" と同じ物差しで比べるため
  function tokyoToday() {
    var ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
    return Date.parse(ymd + 'T00:00:00Z');
  }

  function initNews(root) {
    var list = root.querySelector('.fhp-news-list');
    var items = Array.prototype.slice.call(list.querySelectorAll('.fhp-news-item'));
    var dateOf = function (li) { return Date.parse(li.querySelector('time').getAttribute('datetime') + 'T00:00:00Z'); };
    items.sort(function (a, b) { return dateOf(b) - dateOf(a); });
    items.forEach(function (li) { list.appendChild(li); });

    var newDays = Number(root.dataset.newDays || DEFAULT_NEW_DAYS);
    var today = tokyoToday();
    items.forEach(function (li) {
      var old = li.querySelector('.fhp-news-new');
      if (old) old.remove();
      var age = (today - dateOf(li)) / DAY_MS;
      if (age < 0 || age > newDays) return;
      var mark = document.createElement('span');
      mark.className = 'fhp-news-new';
      mark.textContent = '新着';
      li.querySelector('.fhp-news-meta').appendChild(mark);
    });

    var show = Number(root.dataset.show || DEFAULT_SHOW);
    var more = root.querySelector('.fhp-news-more');
    var rest = items.slice(show);
    if (!more) return;
    if (!rest.length) { more.hidden = true; return; }
    rest.forEach(function (li) { li.hidden = true; });
    more.hidden = false;
    more.textContent = '過去のお知らせを見る（あと' + rest.length + '件）';
    more.addEventListener('click', function () {
      rest.forEach(function (li) { li.hidden = false; });
      more.hidden = true;
      rest[0].tabIndex = -1;
      rest[0].focus();
    });
  }

  function initAll() {
    // 同じ部品のコードを2回貼っても、1つの部品を二重に動かさない
    document.querySelectorAll('[data-fhp-news]').forEach(function (el) {
      if (el.dataset.fhpReady) return;
      el.dataset.fhpReady = 'true';
      initNews(el);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
})();
