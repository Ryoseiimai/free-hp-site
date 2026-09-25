/*
  音声・ボイスサンプル: 本物の <audio> を、店や人のトーンに合わせた見た目で操作する。
  - 再生／一時停止ボタン、波形の棒（押した位置から再生）、経過時間／長さ
  - 1つ再生したら、ページ内の他の音声は止める（部品が2つあっても同じ）
  - 波形は data-peaks（0〜1 の数をカンマ区切り）から描く。無ければ一定の高さの棒にする
  - 波形の上に透明な <input type="range"> を重ね、キーボードの左右キーでも位置を変えられる
*/
(function () {
  'use strict';

  var SEEK_STEPS = 1000;
  var FALLBACK_BARS = 40;
  var MIN_BAR = 0.12;
  var BAR_PITCH_PX = 5;

  // 経過は切り捨て、長さは四捨五入（3.1秒の音が「0:03 / 0:03」で止まらないように）
  function fmt(sec, round) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var s = round ? Math.round(sec) : Math.floor(sec);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // 波形の幅に合わせて棒の数を減らす（狭い画面で棒が細くなりすぎないように）。山は区間の最大で残す
  function fitPeaks(peaks, width) {
    var count = Math.max(8, Math.min(peaks.length, Math.floor(width / BAR_PITCH_PX)));
    if (count >= peaks.length) return peaks;
    var out = [];
    for (var i = 0; i < count; i++) {
      var from = Math.floor(i * peaks.length / count);
      var to = Math.max(from + 1, Math.floor((i + 1) * peaks.length / count));
      out.push(Math.max.apply(null, peaks.slice(from, to)));
    }
    return out;
  }

  function drawBars(container, peaks) {
    var frag = document.createDocumentFragment();
    peaks.forEach(function (p) {
      var bar = document.createElement('span');
      bar.style.height = Math.max(MIN_BAR, p) * 100 + '%';
      frag.appendChild(bar);
    });
    container.replaceChildren(frag);
  }

  function initTrack(track) {
    var audio = track.querySelector('audio');
    var button = track.querySelector('.fhp-voice-play');
    var seek = track.querySelector('.fhp-voice-seek');
    var cur = track.querySelector('.fhp-voice-cur');
    var dur = track.querySelector('.fhp-voice-dur');
    var title = track.querySelector('.fhp-voice-title').textContent.trim();
    var peaks = (track.dataset.peaks || '').split(',').filter(Boolean).map(Number);
    if (!peaks.length) peaks = Array(FALLBACK_BARS).fill(0.6);
    var wave = track.querySelector('.fhp-voice-wave');
    var drawnWidth = 0;
    function redraw() {
      var width = wave.clientWidth;
      if (!width || width === drawnWidth) return;
      drawnWidth = width;
      var fitted = fitPeaks(peaks, width);
      track.querySelectorAll('.fhp-voice-bars').forEach(function (c) { drawBars(c, fitted); });
    }
    redraw();
    if ('ResizeObserver' in window) new ResizeObserver(redraw).observe(wave);

    function duration() {
      return isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(track.dataset.duration || 0);
    }
    function paint() {
      var total = duration();
      var ratio = total ? Math.min(1, audio.currentTime / total) : 0;
      track.style.setProperty('--fhp-voice-progress', (ratio * 100).toFixed(2) + '%');
      seek.value = String(Math.round(ratio * SEEK_STEPS));
      cur.textContent = fmt(audio.currentTime);
      dur.textContent = fmt(total, true);
      seek.setAttribute('aria-valuetext', fmt(audio.currentTime) + ' / ' + fmt(total, true));
    }
    // 再生中は画面の書き換えに合わせて進み具合を塗る（timeupdate だけだと1秒に4回でカクつく）
    function loop() {
      paint();
      if (!audio.paused) requestAnimationFrame(loop);
    }
    function setPlaying(on) {
      if (on) requestAnimationFrame(loop);
      track.classList.toggle('is-playing', on);
      button.setAttribute('aria-label', (on ? '一時停止: ' : '再生: ') + title);
    }

    button.addEventListener('click', function () {
      if (audio.paused) {
        audio.play().catch(function (err) {
          track.dataset.error = err.name;
          setPlaying(false);
        });
      } else {
        audio.pause();
      }
    });
    seek.addEventListener('input', function () {
      var total = duration();
      if (total) audio.currentTime = (Number(seek.value) / SEEK_STEPS) * total;
      paint();
    });
    audio.addEventListener('play', function () { setPlaying(true); });
    audio.addEventListener('pause', function () { setPlaying(false); });
    audio.addEventListener('ended', function () { audio.currentTime = 0; setPlaying(false); paint(); });
    audio.addEventListener('timeupdate', paint);
    audio.addEventListener('loadedmetadata', paint);
    setPlaying(false);
    paint();
  }

  // 1つ再生したら、他の音声を止める
  document.addEventListener('play', function (e) {
    document.querySelectorAll('[data-fhp-voice] audio').forEach(function (a) {
      if (a !== e.target && !a.paused) a.pause();
    });
  }, true);

  function initAll() {
    document.querySelectorAll('[data-fhp-voice] .fhp-voice-track').forEach(initTrack);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
})();
