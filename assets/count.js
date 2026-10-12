/* ============================================================
   Astra Zhou —— 轻量浏览计数
   数据存在 abacus.jasoncameron.dev（免费、免注册、允许跨域读取）。
   用法：
     <span data-count="post-my-slug">—</span>   只读显示该 key 的累计数字
     <body data-hit="post-my-slug">              打开本页时给该 key +1
   任何一步失败都只是显示 “—”，不影响页面其它部分。
   ============================================================ */
(function () {
  'use strict';

  var NS = 'astra-zhou';
  var API = 'https://abacus.jasoncameron.dev/';

  function fmt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function get(key) {
    return fetch(API + 'get/' + NS + '/' + encodeURIComponent(key), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (typeof d.value === 'number') return d.value;
        if (d.error === 'Key not found') return 0;   /* 还没人看过 = 0，而不是读取失败 */
        return null;
      })
      .catch(function () { return null; });
  }

  function hit(key) {
    return fetch(API + 'hit/' + NS + '/' + encodeURIComponent(key), { keepalive: true })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (typeof d.value === 'number') return d.value;
        if (d.error === 'Key not found') return 0;   /* 还没人看过 = 0，而不是读取失败 */
        return null;
      })
      .catch(function () { return null; });
  }

  function fill() {
    var els = document.querySelectorAll('[data-count]');
    Array.prototype.forEach.call(els, function (el) {
      get(el.getAttribute('data-count')).then(function (v) {
        el.textContent = (v === null) ? '—' : fmt(v);
      });
    });
  }

  function boot() {
    initLike();
    var key = document.body && document.body.getAttribute('data-hit');
    if (key) hit(key).then(fill, fill);
    else fill();
  }

  /* ---------- 点赞：点一次 +1，同一浏览器只算一次 ---------- */
  function initLike() {
    var btns = document.querySelectorAll('[data-like]');
    Array.prototype.forEach.call(btns, function (btn) {
      var key = btn.getAttribute('data-like');
      var out = btn.querySelector('.like-n');
      var flag = 'astra_like_' + key;
      var liked = false;
      try { liked = localStorage.getItem(flag) === '1'; } catch (e) {}
      if (liked) btn.classList.add('liked');

      get(key).then(function (v) { if (out) out.textContent = fmt(v === null ? 0 : v); });

      btn.addEventListener('click', function () {
        if (btn.classList.contains('liked')) return;
        btn.classList.add('liked');
        try { localStorage.setItem(flag, '1'); } catch (e) {}
        hit(key).then(function (v) { if (out && v !== null) out.textContent = fmt(v); });
      });
    });
  }

  /* ---------- 图片兜底：CDN 抽风时自动换回源站 ---------- */
  var CDN = 'https://gcore.jsdelivr.net/gh/HosimiyaShoyo/astrazhou@main/';
  var ORIGIN = 'https://hosimiyashoyo.github.io/astrazhou/';

  document.addEventListener('error', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'IMG' || el.getAttribute('data-fallback')) return;
    var s = el.getAttribute('src') || '';
    if (s.indexOf(CDN) === 0) {
      el.setAttribute('data-fallback', '1');
      el.setAttribute('src', ORIGIN + s.slice(CDN.length));
    }
  }, true);

  window.AstraCount = { get: get, hit: hit, fill: fill, fmt: fmt };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

