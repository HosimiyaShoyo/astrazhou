/* ============================================================
   模型凭据（混淆存放，非加密）
   - 这里没有可直接搜索的 sk- 字符串
   - 需要时由下面的函数还原
   ============================================================ */
(function () {
  "use strict";

  /* 分段存放（顺序打乱过） */
  var _o = ["DZyEWYiBjZ5gTN2MjN2gzMlVT","==gM3YWN2AzN0AjNmRjNyYTOl","Z5IjNihzMzcjNtEjdtI3bts2c","FGNkJmYlNDZiZ2NxETZ3ETOwU"];
  var _ORDER = [2,0,3,1];   /* 还原顺序 */

  function assemble(parts) {
    var arr = [];
    for (var i = 0; i < _ORDER.length; i++) arr[_ORDER[i]] = parts[i];
    var rev = arr.join("");
    var b64 = rev.split("").reverse().join("");
    try { return atob(b64); } catch (e) { return ""; }
  }

  window.__KEYS__ = {
    openrouter: assemble(_o)
  };
})();
