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

  function getOnce(key) {
      var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, 6000) : null;
      var opt = ctl ? { cache: 'no-store', signal: ctl.signal } : { cache: 'no-store' };
      return fetch(API + 'get/' + NS + '/' + encodeURIComponent(key), opt)
        .then(function (r) { if (timer) clearTimeout(timer); return r.json(); })
        .then(function (d) {
          if (timer) clearTimeout(timer);
          if (typeof d.value === 'number') return d.value;
          if (d.error === 'Key not found') return 0;
          return null;
        })
        .catch(function () { if (timer) clearTimeout(timer); return null; });
    }
    /* 免费服务偶发 500/超时 —— 失败隔 700ms 再试一次 */
    function get(key) {
      return getOnce(key).then(function (v) {
        if (v !== null) return v;
        return new Promise(function (res) { setTimeout(function () { res(getOnce(key)); }, 700); });
      });
    }
  }, true);

  window.AstraCount = { get: get, hit: hit, fill: fill, fmt: fmt };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

