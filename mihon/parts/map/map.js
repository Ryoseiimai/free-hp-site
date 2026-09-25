/*
  地図: Google マップの埋め込み（APIキー不要の output=embed 形式）を、画面に近づいてから読み込む。
  - data-query に住所か場所の名前。これだけで埋め込み地図を作る
  - 画面の手前 300px まで来たら iframe を入れる（ページの最初の表示を重くしない）
  - 「今すぐ表示」ボタンでも読み込める（キーボードで操作する人・印刷前に見たい人向け）
  - 「地図アプリで開く」「道順」のリンクは HTML に直接書く（JS が動かなくても使える）
*/
(function () {
  'use strict';

  var PRELOAD_MARGIN = '300px 0px';
  var ZOOM = 16;

  function embedUrl(query) {
    return 'https://www.google.com/maps?q=' + encodeURIComponent(query) + '&z=' + ZOOM + '&hl=ja&output=embed';
  }

  function load(root) {
    if (root.dataset.loaded) return;
    root.dataset.loaded = 'true';
    var frame = root.querySelector('.fhp-map-frame');
    var iframe = document.createElement('iframe');
    iframe.src = embedUrl(root.dataset.query);
    iframe.title = root.dataset.title || '地図';
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'no-referrer-when-downgrade';
    iframe.allowFullscreen = true;
    frame.appendChild(iframe);
    var wait = frame.querySelector('.fhp-map-wait');
    if (wait) wait.hidden = true;
  }

  function initMap(root) {
    var now = root.querySelector('.fhp-map-now');
    if (now) now.addEventListener('click', function () { load(root); });
    if (!('IntersectionObserver' in window)) {
      load(root);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      io.disconnect();
      load(root);
    }, { rootMargin: PRELOAD_MARGIN });
    io.observe(root);
  }

  function initAll() {
    // 同じ部品のコードを2回貼っても、1つの部品を二重に動かさない
    document.querySelectorAll('[data-fhp-map]').forEach(function (el) {
      if (el.dataset.fhpReady) return;
      el.dataset.fhpReady = 'true';
      initMap(el);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
})();
