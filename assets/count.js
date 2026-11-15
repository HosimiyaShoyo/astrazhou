/* ============================================================
   Astra Zhou —— 轻量浏览计数 v4

   - 浏览数：abacus（返回 JSON，显示成普通文字，跟上博客排版）
   - 计入时机：滚动到文章 3/4 处才算一次（短文章直接计，30 秒兜底）
   - 稳定性：6 秒超时 + localStorage 缓存上次值 + 全程静默失败
   ============================================================ */
(function () {
  'use strict';

  var API = 'https://abacus.jasoncameron.dev/';
  var NS = 'astra-zhou';
  var TIMEOUT = 6000;
  var STORE = 'astra_cnt_';

  /* ---------- 工具 ---------- */
  function fmt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function cacheGet(key) {
    try {
      var v = localStorage.getItem(STORE + key);
      return v === null ? null : parseInt(v, 10);
    } catch (e) { return null; }
  }
  function cacheSet(key, n) {
    try { localStorage.setItem(STORE + key, String(n)); } catch (e) {}
  }

  function fetchJson(url, opt) {
    var ctl = null, timer = null;
    if (typeof AbortController === 'function') {
      ctl = new AbortController();
      timer = setTimeout(function () { ctl.abort(); }, TIMEOUT);
      opt = opt || {};
      opt.signal = ctl.signal;
    }
    return fetch(url, opt)
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) { if (timer) clearTimeout(timer); return d; })
      .catch(function () { if (timer) clearTimeout(timer); return null; });
  }

  function pick(d) {
    if (!d) return null;
    if (typeof d.value === 'number') return d.value;
    if (d.error === 'Key not found') return 0;
    return null;
  }

  function get(key) {
    return fetchJson(API + 'get/' + NS + '/' + encodeURIComponent(key), { cache: 'no-store' }).then(pick);
  }
  function hit(key) {
    return fetchJson(API + 'hit/' + NS + '/' + encodeURIComponent(key), { keepalive: true }).then(pick);
  }

  /* ---------- 渲染浏览数（文字） ---------- */
  function fill() {
    var els = document.querySelectorAll('[data-count]');
    Array.prototype.forEach.call(els, function (el) {
      var key = el.getAttribute('data-count');
      if (!key) return;

      /* 先放缓存值，页面瞬间就有数 */
      var c = cacheGet(key);
      if (c !== null) el.textContent = fmt(c);

      /* 再取最新的 */
      get(key).then(function (v) {
        if (v === null) return;           /* 失败保持缓存值 */
        el.textContent = fmt(v);
        cacheSet(key, v);
      });
    });
  }

  /* ---------- 文章页：滚过 3/4 才算一次 ---------- */
  var hitSent = false;

  function sendHit() {
    if (hitSent) return;
    hitSent = true;
    var key = document.body && document.body.getAttribute('data-hit');
    if (!key) return;
    hit(key).then(function (v) {
      if (v === null) return;
      cacheSet(key, v);
      /* 本页显示的数字也跟着更新 */
      var el = document.querySelector('[data-count="' + key + '"]');
      if (el) el.textContent = fmt(v);
      fill();
    });
  }

  function watchScroll() {
    if (!document.body || !document.body.getAttribute('data-hit')) return;

    var art = document.querySelector('article') || document.body;
    var ticking = false;

    function check() {
      ticking = false;
      if (hitSent) return;

      var rect = art.getBoundingClientRect();
      var artTop = rect.top + window.pageYOffset;
      var artH = rect.height;
      var targetY = artTop + artH * 0.75;          /* 文章 3/4 处 */
      var seen = window.pageYOffset + window.innerHeight;

      /* 文章不够长、一屏能看完 → 直接计 */
      var docScrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (docScrollable <= 40) { sendHit(); return; }

      if (seen >= targetY) sendHit();
    }

    function onScroll() {
      if (ticking || hitSent) return;
      ticking = true;
      if (window.requestAnimationFrame) requestAnimationFrame(check);
      else setTimeout(check, 60);
    }

    check();
    if (hitSent) return;

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    /* 兜底：看了 30 秒还没滚到 3/4，也算一次 */
    setTimeout(function () { if (!hitSent) sendHit(); }, 30000);
  }

  /* ---------- 点赞 ---------- */
  function initLike() {
    var btns = document.querySelectorAll('[data-like]');
    Array.prototype.forEach.call(btns, function (btn) {
      var key = btn.getAttribute('data-like');
      var out = btn.querySelector('.like-n');
      var flag = 'astra_like_' + key;
      var liked = false;
      try { liked = localStorage.getItem(flag) === '1'; } catch (e) {}
      if (liked) btn.classList.add('liked');

      var c = cacheGet(key);
      if (out && c !== null) out.textContent = fmt(c);

      get(key).then(function (v) {
        if (v === null) return;
        if (out) out.textContent = fmt(v);
        cacheSet(key, v);
      });

      btn.addEventListener('click', function () {
        if (btn.classList.contains('liked')) return;
        btn.classList.add('liked');
        try { localStorage.setItem(flag, '1'); } catch (e) {}
        hit(key).then(function (v) {
          if (v === null) return;
          if (out) out.textContent = fmt(v);
          cacheSet(key, v);
        });
      });
    });
  }

  /* ---------- 图片兜底 ---------- */
  var CDN = 'https://gcore.jsdelivr.net/gh/HosimiyaShoyo/astrazhou@main/';
  function imgFallback() {
    Array.prototype.forEach.call(document.querySelectorAll('img[src*="gcore.jsdelivr.net"]'), function (img) {
      img.addEventListener('error', function () {
        if (img.getAttribute('data-fb')) return;
        img.setAttribute('data-fb', '1');
        var path = img.getAttribute('src').replace(CDN, '');
        img.setAttribute('src', 'assets/' + path.replace(/^assets\//, ''));
      });
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    fill();
    watchScroll();
    initLike();
    imgFallback();
  }

  if ('requestIdleCallback' in window) requestIdleCallback(boot, { timeout: 1200 });
  else setTimeout(boot, 60);

  window.astraCount = { refresh: fill };
})();
