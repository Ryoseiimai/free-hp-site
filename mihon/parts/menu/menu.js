/*
  メニュー・料金表: 分類のタブ切り替え（WAI-ARIA の tabs の作法どおり）。
  左右の矢印キー・Home/End でタブを移り、選んだ分類の一覧だけを見せる。
  「写真つき」「文字だけ」は JS ではなく外側のクラス（fhp-menu--photo / fhp-menu--text）で切り替える。
*/
(function () {
  'use strict';

  function initMenu(root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
    if (!tabs.length) return;

    function select(tab, moveFocus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (moveFocus) tab.focus();
    }

    root.addEventListener('click', function (e) {
      var tab = e.target.closest('[role="tab"]');
      if (tab && tabs.indexOf(tab) !== -1) select(tab, false);
    });
    root.addEventListener('keydown', function (e) {
      var i = tabs.indexOf(document.activeElement);
      if (i === -1) return;
      var next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      select(tabs[(next + tabs.length) % tabs.length], true);
    });

    var initial = tabs.find(function (t) { return t.getAttribute('aria-selected') === 'true'; }) || tabs[0];
    select(initial, false);
  }

  function initAll() {
    document.querySelectorAll('[data-fhp-menu]').forEach(initMenu);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
})();
