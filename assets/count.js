/* ============================================================
   Astra Zhou —— 轻量浏览计数 v3

   浏览数：hits.sh（SVG 徽章，100% 可用，不受免费层休眠影响）
   点赞数：abacus（失败只影响点赞数字，不影响阅读）

   设计要点：
   - 浏览数用 <img> 直接拉 hits.sh，浏览器自己管缓存，快且稳
   - 文章页额外插一张隐藏图完成 +1
   - 点赞用 localStorage 防重复，abacus 挂了也不报错
   - 所有请求都带超时，绝不让页面卡住
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 配置 ---------------- */
  var HITS_BASE = 'https://hits.sh/';
  var SITE = 'astrazhou.is-cool.dev';
  var COLOR = '4d7c0f';        /* 博客的橄榄绿 */
  var LABEL = '%20';           /* 空白标签，只显示数字 */
  var ABACUS = 'https://abacus.jasoncameron.dev/';
  var NS = 'astra-zhou';
  var TIMEOUT = 6000;

  /* ---------------- 工具 ---------------- */
  function hitsUrl(key) {
    /* key 形如 "post-post-20261115" 或 "page-index"
       hits.sh 要求 key 是有效 URI，所以拼成站点路径 */
    var slug = String(key).replace(/^post-/, '').replace(/^page-/, '');
    return HITS_BASE + SITE + '/p/' + encodeURIComponent(slug) + '.svg?label=' + LABEL + '&color=' + COLOR;
  }

  function makeImg(src, cls) {
    var img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.loading = 'lazy';
    img.decoding = 'async';
    if (cls) img.className = cls;
    img.style.cssText = 'display:inline-block;vertical-align:-0.18em;height:1.18em;width:auto;border:0;margin:0';
    return img;
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

  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /* ---------------- 浏览数：换成 hits.sh 图片 ---------------- */
  function renderCounts() {
    var els = document.querySelectorAll('[data-count]');
    Array.prototype.forEach.call(els, function (el) {
      var key = el.getAttribute('data-count');
      if (!key) return;
      /* 已经在里面放过图了就不重复处理 */
      if (el.querySelector('img')) return;
      el.innerHTML = '';
      el.appendChild(makeImg(hitsUrl(key)));
    });
  }

  /* ---------------- 文章页：插入隐藏图完成 +1 ---------------- */
  function pingHit() {
    var key = document.body && document.body.getAttribute('data-hit');
    if (!key) return;
    var img = makeImg(hitsUrl(key));
    img.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px';
    img.loading = 'eager';
    document.body.appendChild(img);
  }

  /* ---------------- 点赞（abacus，可选）---------------- */
  function initLike() {
    var btns = document.querySelectorAll('[data-like]');
    Array.prototype.forEach.call(btns, function (btn) {
      var key = btn.getAttribute('data-like');
      var out = btn.querySelector('.like-n');
      var flag = 'astra_like_' + key;
      var liked = false;
      try { liked = localStorage.getItem(flag) === '1'; } catch (e) {}
      if (liked) btn.classList.add('liked');

      /* 读当前点赞数 */
      fetchJson(ABACUS + 'get/' + NS + '/' + encodeURIComponent(key), { cache: 'no-store' })
        .then(function (d) {
          if (!d || typeof d.value !== 'number') return;
          if (out) out.textContent = fmt(d.value);
        });

      btn.addEventListener('click', function () {
        if (btn.classList.contains('liked')) return;
        btn.classList.add('liked');
        try { localStorage.setItem(flag, '1'); } catch (e) {}
        fetchJson(ABACUS + 'hit/' + NS + '/' + encodeURIComponent(key), { keepalive: true })
          .then(function (d) {
            if (!d || typeof d.value !== 'number') return;
            if (out) out.textContent = fmt(d.value);
          });
      });
    });
  }

  /* ---------------- 图片兜底：CDN 抽风时换回源站 ---------------- */
  var CDN = 'https://gcore.jsdelivr.net/gh/HosimiyaShoyo/astrazhou@main/';
  function imgFallback() {
    var imgs = document.querySelectorAll('img[src*="gcore.jsdelivr.net"]');
    Array.prototype.forEach.call(imgs, function (img) {
      img.addEventListener('error', function () {
        if (img.getAttribute('data-fb')) return;
        img.setAttribute('data-fb', '1');
        var path = img.getAttribute('src').replace(CDN, '');
        img.setAttribute('src', 'assets/' + path.replace(/^assets\//, ''));
      });
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    renderCounts();
    pingHit();
    initLike();
    imgFallback();
  }

  if ('requestIdleCallback' in window) {
    requestIdleCallback(boot, { timeout: 1200 });
  } else {
    setTimeout(boot, 60);
  }

  window.astraCount = { refresh: renderCounts };
})();
