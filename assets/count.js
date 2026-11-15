/* ============================================================
   Astra Zhou —— 轻量浏览计数（慢网络优化版）

   策略：
   1. 先秒显 localStorage 里上次拿到的数字（0 等待）
   2. 后台去请求，带 6 秒超时，超时就保持旧值
   3. 请求成功才覆盖显示，并更新 localStorage
   4. 任何失败都静默处理，页面其它部分完全不受影响

   用法：
     <span data-count="post-my-slug">—</span>   只读显示
     <body data-hit="post-my-slug">              打开本页时 +1
   ============================================================ */
(function () {
  'use strict';

  var NS = 'astra-zhou';
  var API = 'https://abacus.jasoncameron.dev/';
  var TIMEOUT = 6000;
  var STORE = 'astra_cnt_';

  function fmt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* ---- localStorage 缓存（仅用于"先显示上次的值"）---- */
  function cacheGet(key) {
    try {
      var v = localStorage.getItem(STORE + key);
      return v === null ? null : parseInt(v, 10);
    } catch (e) { return null; }
  }
  function cacheSet(key, n) {
    try { localStorage.setItem(STORE + key, String(n)); } catch (e) {}
  }

  /* ---- 带超时的 fetch ---- */
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
    if (d.error === 'Key not found') return 0;   /* 还没人看过 = 0 */
    return null;
  }

  function get(key) {
    return fetchJson(API + 'get/' + NS + '/' + encodeURIComponent(key), { cache: 'no-store' })
      .then(pick);
  }
  function hit(key) {
    return fetchJson(API + 'hit/' + NS + '/' + encodeURIComponent(key), { keepalive: true })
      .then(pick);
  }

  /* ---- 渲染所有 [data-count] ---- */
  function fill() {
    var els = document.querySelectorAll('[data-count]');
    if (!els.length) return;

    Array.prototype.forEach.call(els, function (el) {
      var key = el.getAttribute('data-count');

      /* ① 先放缓存值（如果有），立刻不空着 */
      var c = cacheGet(key);
      if (c !== null) el.textContent = fmt(c);

      /* ② 再去要最新的 */
      get(key).then(function (v) {
        if (v === null) {
          /* 失败：如果之前也没缓存，就保持 "—" */
          return;
        }
        el.textContent = fmt(v);
        cacheSet(key, v);
      });
    });
  }

  /* ---- 点赞 ---- */
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

  /* ---- 图片兜底：CDN 抽风时换回源站 ---- */
  var CDN = 'https://gcore.jsdelivr.net/gh/HosimiyaShoyo/astrazhou@main/';
  function imgFallback() {
    var imgs = document.querySelectorAll('img[src*="gcore.jsdelivr.net"]');
    Array.prototype.forEach.call(imgs, function (img) {
      img.addEventListener('error', function () {
        var once = img.getAttribute('data-fb');
        if (once) return;
        img.setAttribute('data-fb', '1');
        var path = img.getAttribute('src').replace(CDN, '');
        img.setAttribute('src', 'assets/' + path.replace(/^assets\//, ''));
      });
    });
  }

  /* ---- 启动 ---- */
  function boot() {
    initLike();
    imgFallback();

    var key = document.body && document.body.getAttribute('data-hit');

    /* 有 data-hit 的（文章页）先 +1 再刷新列表；
       没有的（首页/列表页）直接渲染缓存里的值。 */
    if (key) {
      var c = cacheGet(key);
      if (c !== null) {
        var el = document.querySelector('[data-count="' + key + '"]');
        if (el) el.textContent = fmt(c + 1);
      }
      hit(key).then(function (v) {
        if (v !== null) cacheSet(key, v);
        fill();
      });
    } else {
      fill();
    }
  }

  /* 页面空闲时再跑，不和首屏渲染抢资源 */
  if ('requestIdleCallback' in window) {
    requestIdleCallback(boot, { timeout: 1500 });
  } else {
    setTimeout(boot, 60);
  }

  /* 暴露给外部，需要时可以手动刷新 */
  window.astraCount = { refresh: fill };
})();
