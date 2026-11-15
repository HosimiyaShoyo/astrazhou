/* ============================================================
   Astra Zhou —— 浏览计数 v5（离线优先 + 后台同步）

   思路：
   ┌─────────────────────────────────────────────┐
   │ 显示值 = 服务器已知值(server) + 本地待同步(pending) │
   └─────────────────────────────────────────────┘

   1. 打开页面 → 立刻用「server + pending」显示（0 延迟，不依赖网络）
   2. 命中条件（滚到 3/4）→ pending +1，界面马上 +1
   3. 后台把 pending 个 +1 批量上报给服务器
   4. 成功 → server += pending，pending 清零，下次打开就是新值
   5. 失败 → pending 保留，下次打开/下次同步时一起补上去

   结果：即使服务器挂了，你的浏览也不会丢，恢复后自动补上。
   ============================================================ */
(function () {
  'use strict';

  var API = 'https://abacus.jasoncameron.dev/';
  var NS = 'astra-zhou';
  var TIMEOUT = 6000;
  var K_SERVER = 'astra_srv_';    /* 服务器已确认的值 */
  var K_PENDING = 'astra_pnd_';   /* 还没同步上去的次数 */

  /* ---------- 工具 ---------- */
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function numGet(k) {
    try { var v = localStorage.getItem(k); return v === null ? 0 : (parseInt(v, 10) || 0); } catch (e) { return 0; }
  }
  function numSet(k, n) {
    try { localStorage.setItem(k, String(n)); } catch (e) {}
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

  function apiGetOnce(key) {
    return fetchJson(API + 'get/' + NS + '/' + encodeURIComponent(key), { cache: 'no-store' }).then(pick);
  }

  /* abacus 会间歇 500，读的时候多试几次，成功一次就够 */
  function apiGet(key, tries) {
    tries = tries || 4;
    function attempt(n) {
      return apiGetOnce(key).then(function (v) {
        if (v !== null) return v;
        if (n >= tries) return null;
        return new Promise(function (res) {
          setTimeout(function () { res(attempt(n + 1)); }, 400 * n);
        });
      });
    }
    return attempt(1);
  }
  function apiHit(key) {
    return fetchJson(API + 'hit/' + NS + '/' + encodeURIComponent(key), { keepalive: true }).then(pick);
  }

  /* ---------- 本地状态 ---------- */
  function getServer(key) { return numGet(K_SERVER + key); }
  function getPending(key) { return numGet(K_PENDING + key); }
  function setServer(key, n) { numSet(K_SERVER + key, n); }
  function setPending(key, n) { numSet(K_PENDING + key, n); }

  /* 显示值 */
  function displayValue(key) {
    return getServer(key) + getPending(key);
  }

  /* 把值写到页面上所有对应元素 */
  function paint(key) {
    var v = displayValue(key);
    var els = document.querySelectorAll('[data-count="' + key + '"]');
    Array.prototype.forEach.call(els, function (el) {
      el.textContent = fmt(v);
    });
    return v;
  }

  /* ---------- 同步：把 pending 补到服务器 ---------- */
  var syncing = {};

  function sync(key) {
    if (!key) return Promise.resolve();
    if (syncing[key]) return syncing[key];

    var pending = getPending(key);
    var server = getServer(key);

    /* 本地还没记过数，但服务器可能有新的（别的设备浏览过）→ 先拉一次 */
    if (pending === 0) {
      syncing[key] = apiGet(key).then(function (v) {
        delete syncing[key];
        if (v === null) return;               /* 4 次都失败：保持本地 */
        if (v > server) {
          /* 服务器更新，采纳并覆盖本地 */
          setServer(key, v);
          paint(key);
        } else if (v < server && server > 0) {
          /* 本地比服务器新（比如上次没同步上去），不改，交给 pending 逻辑 */
        }
        return v;
      });
      return syncing[key];
    }

    /* 有 pending：逐个 +1 上报（abacus 只支持单次 +1，所以要循环） */
    syncing[key] = (function () {
      var chain = Promise.resolve(server);
      var okCount = 0;
      for (var i = 0; i < pending; i++) {
        chain = chain.then(function (cur) {
          return apiHit(key).then(function (v) {
            if (v === null) throw new Error('fail');
            okCount++;
            return v;
          });
        });
      }
      return chain
        .then(function (finalV) {
          /* 全部成功 */
          delete syncing[key];
          setServer(key, finalV);
          setPending(key, 0);
          paint(key);
          return finalV;
        })
        .catch(function () {
          /* 部分成功：把已上报的扣掉，剩下的留着下次补 */
          delete syncing[key];
          if (okCount > 0) {
            setPending(key, pending - okCount);
            setServer(key, server + okCount);
            paint(key);
          }
          return null;
        });
    })();

    return syncing[key];
  }

  /* ---------- 文章页：滚过 3/4 记一次 ---------- */
  var hitDone = false;

  function recordHit() {
    if (hitDone) return;
    hitDone = true;

    var key = document.body && document.body.getAttribute('data-hit');
    if (!key) return;

    /* ① 本地先记账 —— 界面立刻 +1，完全不依赖网络 */
    setPending(key, getPending(key) + 1);
    paint(key);

    /* ② 后台同步 */
    if ('requestIdleCallback' in window) {
      requestIdleCallback(function () { sync(key); }, { timeout: 3000 });
    } else {
      setTimeout(function () { sync(key); }, 300);
    }
  }

  function watchScroll() {
    if (!document.body || !document.body.getAttribute('data-hit')) return;

    var art = document.querySelector('article') || document.body;
    var ticking = false;

    function check() {
      ticking = false;
      if (hitDone) return;

      var rect = art.getBoundingClientRect();
      var artTop = rect.top + window.pageYOffset;
      var targetY = artTop + rect.height * 0.75;
      var seen = window.pageYOffset + window.innerHeight;
      var docScrollable = document.documentElement.scrollHeight - window.innerHeight;

      if (docScrollable <= 40) { recordHit(); return; }
      if (seen >= targetY) recordHit();
    }

    function onScroll() {
      if (ticking || hitDone) return;
      ticking = true;
      if (window.requestAnimationFrame) requestAnimationFrame(check);
      else setTimeout(check, 60);
    }

    check();
    if (hitDone) return;

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    setTimeout(function () { if (!hitDone) recordHit(); }, 30000);
  }

  /* ---------- 列表页：先用本地值渲染，再拉服务器 ---------- */
  function initCounts() {
    var els = document.querySelectorAll('[data-count]');
    var keys = {};
    Array.prototype.forEach.call(els, function (el) {
      var k = el.getAttribute('data-count');
      if (k) keys[k] = true;
    });
    var list = Object.keys(keys);
    if (!list.length) return;

    /* ① 立刻用本地值（server + pending）填充，0 延迟 */
    list.forEach(paint);

    /* ② 后台逐个和服务器对账 */
    list.forEach(function (k, i) {
      setTimeout(function () { sync(k); }, 120 * i);
    });
  }

  /* ---------- 点赞（沿用本地 + 服务） ---------- */
  function initLike() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-like]'), function (btn) {
      var key = btn.getAttribute('data-like');
      var out = btn.querySelector('.like-n');
      var flag = 'astra_like_' + key;
      var liked = false;
      try { liked = localStorage.getItem(flag) === '1'; } catch (e) {}
      if (liked) btn.classList.add('liked');

      if (out) out.textContent = fmt(displayValue(key));
      sync(key).then(function () { if (out) out.textContent = fmt(displayValue(key)); });

      btn.addEventListener('click', function () {
        if (btn.classList.contains('liked')) return;
        btn.classList.add('liked');
        try { localStorage.setItem(flag, '1'); } catch (e) {}
        setPending(key, getPending(key) + 1);
        if (out) out.textContent = fmt(displayValue(key));
        sync(key);
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
    initCounts();
    watchScroll();
    initLike();
    imgFallback();

    /* 再补一次对账：5 秒后如果还有 key 的 server 值为 0，
       说明第一次没拉到，再试一轮（应对 abacus 的不稳定） */
    setTimeout(function () {
      Array.prototype.forEach.call(document.querySelectorAll('[data-count]'), function (el) {
        var k = el.getAttribute('data-count');
        if (k && getServer(k) === 0) sync(k);
      });
    }, 5000);
  }

  function kick() {
    if ('requestIdleCallback' in window) requestIdleCallback(boot, { timeout: 1200 });
    else setTimeout(boot, 60);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', kick);
  } else {
    kick();
  }

  /* 页面要走了，顺手把 pending 推一次（失败也没关系，下次会补） */
  window.addEventListener('pagehide', function () {
    var key = document.body && document.body.getAttribute('data-hit');
    if (key && getPending(key) > 0) sync(key);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden') return;
    var key = document.body && document.body.getAttribute('data-hit');
    if (key && getPending(key) > 0) sync(key);
  });

  window.astraCount = {
    refresh: initCounts,
    pending: function (k) { return getPending(k); },
    sync: sync,
    /* 手动给某个 key 设一个本地基准值（会覆盖本地 server 值） */
    setBase: function (k, v) { setServer(k, v); paint(k); },
    /* 导出所有本地计数，方便排查 */
    dump: function () {
      var out = {};
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf(K_SERVER) === 0) {
          var k2 = key.slice(K_SERVER.length);
          out[k2] = { server: getServer(k2), pending: getPending(k2), show: displayValue(k2) };
        }
      }
      return out;
    }
  };
})();
