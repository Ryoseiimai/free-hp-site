/*
  聞き返し: 「どんなホームページにしたいか」を4問の選択式で聞き、答えから部品の組み合わせを提案する。
  - 送信はしない。提案の下に相談先へのメールのリンク（答えと提案を本文に入れたもの）だけ出す。
    相談先は data-mail（既定 info@freehp.jp）。自分のサイトで使うときは自分のアドレスに書き換える
  - 部品の説明リンクは data-catalog（既定は同じページ）+ #部品名 に飛ぶ
  - 提案の決まり（RULES）: 答えに当てはまる理由を1つずつ見て、先に当たった理由を使う。
    Q2「いちばん見てほしいもの」で選ばれた部品を先頭（まず入れる部品）にする
*/
(function () {
  'use strict';

  var MAIL_TO = 'info@freehp.jp';
  var MAIL_SUBJECT = 'ホームページの相談（部品の組み合わせ）';
  var PRIMARY_COUNT = 2;

  var PARTS = {
    gallery: '写真ギャラリー',
    menu: 'メニュー・料金表',
    map: '地図',
    contact: '予約・問い合わせ',
    voice: '音声・ボイスサンプル',
    news: 'お知らせ',
    faq: 'よくある質問'
  };

  // [部品, 当てはまる条件, 理由]。上から順に見る
  var RULES = [
    ['gallery', function (a) { return a.look.indexOf('photos') !== -1; }, '写真を一覧にして、押すと大きく見られるようにします。'],
    ['gallery', function (a) { return a.work === 'creator'; }, '作品やジャケットの画像を、押すと大きく見られる一覧にします。'],
    ['menu', function (a) { return a.look.indexOf('prices') !== -1; }, '分類ごとに切り替えられる料金表にします。価格は税込で出します。'],
    ['menu', function (a) { return a.work === 'food' || a.work === 'booking'; }, 'メニューと料金を、分類ごとに切り替えて見られるようにします。'],
    ['voice', function (a) { return a.look.indexOf('sound') !== -1 || a.work === 'creator'; }, '声や曲を、その場で再生して聞けるようにします。1つ再生すると他は止まります。'],
    ['map', function (a) { return a.look.indexOf('place') !== -1; }, 'Google マップと「地図アプリで開く」ボタンを置きます。'],
    ['map', function (a) { return a.work !== 'creator'; }, 'お店の場所がすぐ分かるよう、地図と道順のボタンを置きます。'],
    ['contact', function (a) { return a.contact === 'tel'; }, '営業中は電話のボタンを大きく出し、時間外は予約やLINEに切り替えます。'],
    ['contact', function (a) { return a.contact === 'line' || a.contact === 'reserve'; }, '予約・LINEのボタンと、いま営業中かどうかを表示します。'],
    ['news', function (a) { return a.update === 'often'; }, '日付つきのお知らせを新しい順に並べ、新しいものに印を付けます。'],
    ['faq', function (a) { return a.work === 'booking'; }, '予約の取り方や当日の流れなど、よく聞かれることを開閉式でまとめます。'],
    ['faq', function (a) { return a.work === 'creator'; }, '依頼の受け方や納期など、よく聞かれることを開閉式でまとめます。'],
    ['faq', function () { return true; }, '支払い方法や駐車場など、よく聞かれることを開閉式でまとめます。']
  ];

  var LOOK_TO_PART = { photos: 'gallery', prices: 'menu', place: 'map', sound: 'voice' };

  function labelOf(input) {
    return input.closest('label').querySelector('.fhp-hear-label').textContent.trim();
  }

  function readAnswers(form) {
    var pick = function (name) {
      var el = form.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : '';
    };
    var looks = Array.prototype.slice.call(form.querySelectorAll('input[name="look"]:checked'));
    return {
      work: pick('work'),
      look: looks.map(function (el) { return el.value; }),
      contact: pick('contact'),
      update: pick('update')
    };
  }

  function propose(answers) {
    var chosen = [];
    RULES.forEach(function (rule) {
      var part = rule[0];
      if (chosen.some(function (c) { return c.part === part; })) return;
      if (rule[1](answers)) chosen.push({ part: part, reason: rule[2] });
    });
    var wanted = answers.look.map(function (v) { return LOOK_TO_PART[v]; });
    var rank = function (c) { var i = wanted.indexOf(c.part); return i === -1 ? wanted.length : i; };
    return chosen
      .map(function (c, i) { return { c: c, i: i }; })
      .sort(function (x, y) { return rank(x.c) - rank(y.c) || x.i - y.i; })
      .map(function (x) { return x.c; });
  }

  function mailHref(form, list, mailTo) {
    var lines = Array.prototype.slice.call(form.querySelectorAll('fieldset')).map(function (fs) {
      var picked = Array.prototype.slice.call(fs.querySelectorAll('input:checked')).map(labelOf);
      return fs.dataset.short + ': ' + (picked.join('、') || 'とくになし');
    });
    lines.push('提案された部品: ' + list.map(function (c) { return PARTS[c.part]; }).join('、'));
    var body = 'ホームページの相談です。\n\n' + lines.join('\n') + '\n\n（ここに、お店や活動の名前と、ご希望があれば書いてください）\n';
    return 'mailto:' + mailTo + '?subject=' + encodeURIComponent(MAIL_SUBJECT) + '&body=' + encodeURIComponent(body);
  }

  function item(c, base, primary) {
    var li = document.createElement('li');
    li.className = primary ? 'fhp-hear-pick is-primary' : 'fhp-hear-pick';
    var name = document.createElement('p');
    name.className = 'fhp-hear-pick-name';
    var a = document.createElement('a');
    a.href = base + '#' + c.part;
    a.textContent = PARTS[c.part];
    name.appendChild(a);
    var reason = document.createElement('p');
    reason.className = 'fhp-hear-pick-reason';
    reason.textContent = c.reason;
    li.appendChild(name);
    li.appendChild(reason);
    return li;
  }

  function initHearing(root) {
    var form = root.querySelector('form');
    var result = root.querySelector('.fhp-hear-result');
    var error = root.querySelector('.fhp-hear-error');
    var base = root.dataset.catalog || '';
    var mailTo = root.dataset.mail || MAIL_TO;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var missing = Array.prototype.slice.call(form.querySelectorAll('fieldset[data-required]'))
        .filter(function (fs) { return !fs.querySelector('input:checked'); });
      form.querySelectorAll('fieldset').forEach(function (fs) {
        var isMissing = missing.indexOf(fs) !== -1;
        fs.classList.toggle('is-missing', isMissing);
        if (isMissing) fs.setAttribute('aria-invalid', 'true');
        else fs.removeAttribute('aria-invalid');
      });
      if (missing.length) {
        error.textContent = '「' + missing[0].dataset.short + '」を選んでください。';
        error.hidden = false;
        missing[0].querySelector('input').focus();
        return;
      }
      error.hidden = true;
      var list = propose(readAnswers(form));
      var primary = result.querySelector('.fhp-hear-primary');
      var secondary = result.querySelector('.fhp-hear-secondary');
      primary.innerHTML = '';
      secondary.innerHTML = '';
      list.forEach(function (c, i) {
        (i < PRIMARY_COUNT ? primary : secondary).appendChild(item(c, base, i < PRIMARY_COUNT));
      });
      result.querySelector('.fhp-hear-secondary-wrap').hidden = list.length <= PRIMARY_COUNT;
      result.querySelector('.fhp-hear-mail').href = mailHref(form, list, mailTo);
      var shown = result.querySelector('.fhp-hear-mail-to');
      if (shown) shown.textContent = mailTo;
      result.hidden = false;
      if (window.insertPhraseBreaks) {
        window.insertPhraseBreaks(primary);
        window.insertPhraseBreaks(secondary);
      }
      var heading = result.querySelector('.fhp-hear-result-title');
      heading.tabIndex = -1;
      heading.focus();
    });

    // 選び直したら、その問いの「選んでください」の印を外す
    form.addEventListener('change', function (e) {
      var fs = e.target.closest('fieldset.is-missing');
      if (!fs) return;
      fs.classList.remove('is-missing');
      fs.removeAttribute('aria-invalid');
    });

    form.addEventListener('reset', function () {
      result.hidden = true;
      error.hidden = true;
      form.querySelectorAll('fieldset.is-missing').forEach(function (fs) {
        fs.classList.remove('is-missing');
        fs.removeAttribute('aria-invalid');
      });
    });
  }

  function initAll() {
    // 同じ部品のコードを2回貼っても、1つの部品を二重に動かさない
    document.querySelectorAll('[data-fhp-hearing]').forEach(function (el) {
      if (el.dataset.fhpReady) return;
      el.dataset.fhpReady = 'true';
      initHearing(el);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
})();
