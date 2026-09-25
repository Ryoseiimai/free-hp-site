/*
  写真ギャラリー: 一覧の写真を押すと画面いっぱいに拡大する。
  操作: 左右の矢印キー・Home/End で送る、Esc で閉じる。スマホは左右にスワイプ。
  一覧の <button class="fhp-gallery-item" data-large="大きい画像" data-caption="説明"> を開くたびに数え直すので、
  写真を足したり減らしたりしても JS は触らなくてよい。
*/
(function () {
  'use strict';

  var SWIPE_MIN_PX = 50;
  var ICON_PREV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

  function buildDialog() {
    var dialog = document.createElement('dialog');
    dialog.className = 'fhp-lightbox';
    dialog.setAttribute('aria-label', '写真の拡大表示');
    dialog.innerHTML =
      '<div class="fhp-lb-bar">' +
        '<p class="fhp-lb-count" aria-live="polite"></p>' +
        '<button type="button" class="fhp-lb-btn" data-lb="close">' + ICON_CLOSE + '<span>閉じる</span></button>' +
      '</div>' +
      '<div class="fhp-lb-stage"><img class="fhp-lb-img" alt=""></div>' +
      '<div class="fhp-lb-foot">' +
        '<p class="fhp-lb-caption"></p>' +
        '<div class="fhp-lb-nav">' +
          '<button type="button" class="fhp-lb-btn" data-lb="prev" aria-label="前の写真">' + ICON_PREV + '</button>' +
          '<button type="button" class="fhp-lb-btn" data-lb="next" aria-label="次の写真">' + ICON_NEXT + '</button>' +
        '</div>' +
      '</div>';
    return dialog;
  }

  function initGallery(root) {
    var dialog = buildDialog();
    root.appendChild(dialog);
    var img = dialog.querySelector('.fhp-lb-img');
    var stage = dialog.querySelector('.fhp-lb-stage');
    var count = dialog.querySelector('.fhp-lb-count');
    var caption = dialog.querySelector('.fhp-lb-caption');
    var items = [];
    var index = 0;
    var opener = null;

    function preload(i) {
      var item = items[(i + items.length) % items.length];
      if (item) new Image().src = item.dataset.large;
    }

    function show(i) {
      index = (i + items.length) % items.length;
      var item = items[index];
      var thumb = item.querySelector('img');
      img.classList.remove('is-shown');
      img.style.transform = '';
      img.src = item.dataset.large || thumb.currentSrc || thumb.src;
      img.alt = thumb.alt;
      void img.offsetWidth; // アニメーションをやり直すための再計算
      img.classList.add('is-shown');
      count.textContent = (index + 1) + ' / ' + items.length;
      caption.textContent = item.dataset.caption || '';
      if (window.insertPhraseBreaks) window.insertPhraseBreaks(caption.parentNode);
      preload(index + 1);
      preload(index - 1);
    }

    function open(item) {
      items = Array.prototype.slice.call(root.querySelectorAll('.fhp-gallery-item'));
      opener = item;
      show(items.indexOf(item));
      document.documentElement.classList.add('fhp-lb-lock');
      dialog.showModal();
      dialog.querySelector('[data-lb="next"]').focus();
    }

    root.addEventListener('click', function (e) {
      var item = e.target.closest('.fhp-gallery-item');
      if (item && root.contains(item)) open(item);
    });

    dialog.addEventListener('close', function () {
      document.documentElement.classList.remove('fhp-lb-lock');
      if (opener && document.contains(opener)) opener.focus();
    });

    dialog.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-lb]');
      if (btn) {
        var action = btn.dataset.lb;
        if (action === 'close') dialog.close();
        if (action === 'prev') show(index - 1);
        if (action === 'next') show(index + 1);
        return;
      }
      // 写真の外側（暗い地）を押したときだけ閉じる。スワイプの直後は閉じない
      if (e.target === stage && pressTarget === stage && !swiped) dialog.close();
    });

    dialog.addEventListener('keydown', function (e) {
      var keys = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: items.length - 1 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      show(keys[e.key]);
    });

    // スワイプ: 指に合わせて写真を動かし、離した位置で前後を決める
    var startX = null;
    var swiped = false;
    var pressTarget = null;
    stage.addEventListener('pointerdown', function (e) {
      pressTarget = e.target;
      if (e.pointerType === 'mouse') return;
      startX = e.clientX;
      swiped = false;
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', function (e) {
      if (startX === null) return;
      img.style.transform = 'translateX(' + (e.clientX - startX) + 'px)';
    });
    function endSwipe(e) {
      if (startX === null) return;
      var dx = e.clientX - startX;
      startX = null;
      img.style.transform = '';
      if (Math.abs(dx) < SWIPE_MIN_PX) return;
      swiped = true;
      show(dx < 0 ? index + 1 : index - 1);
      setTimeout(function () { swiped = false; }, 0);
    }
    stage.addEventListener('pointerup', endSwipe);
    stage.addEventListener('pointercancel', function () { startX = null; img.style.transform = ''; });
  }

  function initAll() {
    // 同じ部品のコードを2回貼っても、1つの部品を二重に動かさない
    document.querySelectorAll('[data-fhp-gallery]').forEach(function (el) {
      if (el.dataset.fhpReady) return;
      el.dataset.fhpReady = 'true';
      initGallery(el);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
})();
