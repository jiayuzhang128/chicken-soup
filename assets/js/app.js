/* ============================================================
   今日鸡汤 · 应用逻辑
   —— 纯静态实现：hash 路由 + 按日期轮换的每日一句 + 收藏
   ============================================================ */
(function () {
  "use strict";

  /* 全局脚本异常可视化：出问题时给用户明确提示，而不是无声坏掉 */
  window.addEventListener("error", function (e) {
    try {
      var el = document.getElementById("toast");
      if (el) { el.textContent = "脚本异常：" + (e.message || "未知错误"); el.classList.add("show"); }
    } catch (err) {}
  });

  var app = document.getElementById("app");
  var toastEl = document.getElementById("toast");
  var modalRoot = document.getElementById("modalRoot");
  var favCountEl = document.getElementById("favCount");

  var DAY_MS = 86400000;
  var FAV_KEY = "csd_favs_v1";
  var THEME_META = {
    maoxuan:  { name: "毛选语录", route: "#/maoxuan",    char: "毛", desc: "《毛泽东选集》四卷经典语录，外加诗词名句。矛盾、实践、群众、持久战——把日子过明白的硬核方法论。" },
    sanshiliuji: { name: "三十六计", route: "#/sanshiliuji", char: "计", desc: "中国古代谋略集大成之作，六套三十六计，原文、白话、典故俱全。做人做事，多一点章法。" },
    tiandao:  { name: "天道众生相", route: "#/tiandao",   char: "道", desc: "王志文《天道》：万般努力只为出人头地，忍人所不忍、能人所不能。生存法则与文化属性的众生相。" },
    juexing:  { name: "自我觉醒", route: "#/juexing",    char: "醒", desc: "人生要开五次窍：祛魅、忘情、归已、泯生、回归。开到第五次，才算真正活明白。" }
  };

  /* ---------------- 数据归一化 ---------------- */

  var flat = { maoxuan: [], sanshiliuji: [], tiandao: [], juexing: [] };
  var maoVolumes = [];        // 毛选卷（含诗词名句伪卷）
  var maoTodayRef = null;     // 今日毛选语录的定位 { volIdx, artIdx, quoteIdx }
  var jiCats = [];
  var jiTodayRef = null;
  var awakenStages = [];

  function buildMao() {
    var d = window.MAOXUAN_DATA;
    if (!d) return;
    maoVolumes = d.volumes.map(function (v) {
      return { name: v.name, period: v.period, articles: v.articles.map(function (a) {
        return { title: a.title, date: a.date || "", quotes: a.quotes || [] };
      }) };
    });
    if (d.poems && d.poems.quotes && d.poems.quotes.length) {
      maoVolumes.push({
        name: d.poems.name || "诗词名句", period: "豪放词章 · 自作诗词",
        articles: [{ title: "诗词名句", date: "", quotes: d.poems.quotes }]
      });
    }
    maoVolumes.forEach(function (vol, vi) {
      vol.articles.forEach(function (art, ai) {
        art.quotes.forEach(function (q, qi) {
          flat.maoxuan.push({
            id: "maoxuan:" + vi + ":" + ai + ":" + qi,
            theme: "maoxuan",
            text: q.text,
            tag: q.tag || "",
            title: "",
            source: vol.name === "诗词名句" ? (q.source || "毛泽东诗词") : "《毛泽东选集》" + vol.name + " · " + art.title,
            sourceTitle: art.title,
            ref: { volIdx: vi, artIdx: ai, quoteIdx: qi }
          });
        });
      });
    });
  }

  function buildJi() {
    var d = window.SSJJ_DATA;
    if (!d) return;
    jiCats = d.categories.map(function (c) {
      return { name: c.name, desc: c.desc || "", items: c.items.slice() };
    });
    jiCats.forEach(function (c, ci) {
      c.items.forEach(function (it, ii) {
        it.cat = c.name;
        it.essence = (it.meaning || "").split(/[。；]/)[0] + "。";
        var model = {
          id: "sanji:" + it.id,
          theme: "sanshiliuji",
          text: it.meaning,
          tag: c.name,
          title: it.name,
          source: "《三十六计》" + c.name + " · 第" + it.id + "计",
          ref: { catIdx: ci, itemIdx: ii }
        };
        flat.sanshiliuji.push(model);
        it.model = model;
      });
    });
  }

  function buildTiandao() {
    var d = window.TIANDAO_DATA;
    if (!d) return;
    d.groups.forEach(function (g, gi) {
      g.quotes.forEach(function (q, qi) {
        flat.tiandao.push({
          id: "tiandao:" + gi + ":" + qi,
          theme: "tiandao",
          text: q.text,
          tag: q.tag || "",
          title: "",
          source: "《天道》" + (q.source ? " · " + q.source : ""),
          group: g.name
        });
      });
    });
  }

  function buildJuexing() {
    var d = window.JUEXING_DATA;
    if (!d) return;
    awakenStages = d.stages;
    d.stages.forEach(function (s, si) {
      flat.juexing.push({
        id: "juexing:" + si,
        theme: "juexing",
        text: s.text,
        tag: s.tag || "",
        title: s.name,
        source: "自我觉醒 · " + s.label + "「" + s.name + "」",
        ref: { stageIdx: si }
      });
    });
  }

  function cnNum(n) {
    var c = "零一二三四五六七八九";
    if (n <= 10) return n === 10 ? "十" : c[n];
    if (n < 20) return "十" + c[n % 10];
    var t = Math.floor(n / 10), o = n % 10;
    return c[t] + "十" + (o ? c[o] : "");
  }

  /* ---------------- 每日轮换 ---------------- */

  function dayNum(ts) {
    var d = ts != null ? new Date(ts) : new Date();
    return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / DAY_MS);
  }
  function pickDaily(list, dNum) {
    if (!list.length) return null;
    return list[((dNum % list.length) + list.length) % list.length];
  }
  function dailyOf(theme, dNum) {
    return pickDaily(flat[theme] || [], dNum == null ? dayNum() : dNum);
  }

  var WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  function fmtDate(d) {
    return d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
  }
  function fmtShort(d) {
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }
  function dayOfYear(d) {
    var start = new Date(d.getFullYear(), 0, 1);
    return Math.floor((d - start) / DAY_MS) + 1;
  }

  /* ---------------- 收藏 ---------------- */

  function favs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch (e) { return []; }
  }
  function saveFavs(list) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function isFaved(id) { return favs().some(function (f) { return f.id === id; }); }
  function toggleFav(quote, anchorEl) {
    var list = favs();
    var idx = list.findIndex(function (f) { return f.id === quote.id; });
    var added;
    if (idx >= 0) { list.splice(idx, 1); added = false; }
    else { list.unshift({ id: quote.id, theme: quote.theme, title: quote.title || "", text: quote.text, source: quote.source, savedAt: Date.now() }); added = true; }
    saveFavs(list);
    updateFavBadge(added);
    if (added && anchorEl) spawnSparks(anchorEl);
    toast(added ? "已收入汤碗" : "已从汤碗移出");
    return added;
  }
  function updateFavBadge(pulse) {
    var n = favs().length;
    favCountEl.hidden = n === 0;
    favCountEl.textContent = n > 99 ? "99+" : n;
    if (pulse) {
      favCountEl.classList.remove("pulse");
      void favCountEl.offsetWidth;
      favCountEl.classList.add("pulse");
    }
  }

  /* ---------------- 小工具 ---------------- */

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 1900);
  }

  function copyText(text, btn) {
    function done(ok) {
      toast(ok ? "已复制到剪贴板" : "复制失败，请手动选择文本");
      if (btn && ok) {
        var prev = btn.innerHTML;
        btn.classList.add("is-ok", "ok");
        btn.innerHTML = icon("check") + (btn.classList.contains("icon-btn") ? "" : "已复制");
        setTimeout(function () { btn.innerHTML = prev; btn.classList.remove("is-ok", "ok"); }, 1300);
      }
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;left:-999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else fallback();
  }

  function quoteCopyText(q) {
    return "「" + q.text + "」\n—— " + q.source;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function bindReveals(root) {
    var els = root.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -4% 0px" });
    els.forEach(function (el, i) {
      el.style.animationDelay = Math.min(i * 45, 300) + "ms";
      io.observe(el);
    });
    /* 兜底：无头浏览器/打印等 IO 不触发环境下，保证内容最终可见 */
    setTimeout(function () {
      els.forEach(function (el) { el.classList.add("in"); });
    }, 2200);
  }

  function iconBtn(cls, glyph, label, extra) {
    return '<button class="icon-btn ' + cls + (extra || "") + '" title="' + label + '" aria-label="' + label + '">' + icon(glyph) + "</button>";
  }

  /* ---------------- 图标系统（线性 SVG，统一 1.8 描边） ---------------- */

  var ICONS = {
    copy: '<svg class="icon" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/></svg>',
    check: '<svg class="icon" viewBox="0 0 24 24"><path d="M4.5 12.5l5 5 10-11"/></svg>',
    heart: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 20.5S3.5 15.5 3.5 9.3C3.5 6.2 6 4 8.6 4c1.5 0 2.7.7 3.4 1.8C12.7 4.7 14 4 15.4 4 18 4 20.5 6.2 20.5 9.3c0 6.2-8.5 11.2-8.5 11.2z"/></svg>',
    sun: '<svg class="icon sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7"/></svg>',
    shuffle: '<svg class="icon sm" viewBox="0 0 24 24"><path d="M3 7h3.5c5.5 0 8.5 10 14 10H21M3 17h3.5c2 0 3.6-1.6 4.9-3.3M21 7h-.5c-2.6 0-4.5 1.9-6 3.9"/><path d="M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>',
    undo: '<svg class="icon sm" viewBox="0 0 24 24"><path d="M8 5L3 10l5 5"/><path d="M3 10h11a6 6 0 0 1 0 12h-3"/></svg>',
    search: '<svg class="icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/></svg>',
    close: '<svg class="icon" viewBox="0 0 24 24"><path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/></svg>',
    chevron: '<svg class="icon sm" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    arrow: '<svg class="icon sm" viewBox="0 0 24 24"><path d="M4 12h15M13.5 5.5L20 12l-6.5 6.5"/></svg>',
    bowl: '<svg class="icon" viewBox="0 0 24 24"><path d="M3.5 11h17a8.5 8.5 0 0 1-6.5 8.2V21h-4v-1.8A8.5 8.5 0 0 1 3.5 11z"/></svg>'
  };
  function icon(name) { return ICONS[name] || ""; }

  /* 收藏成功时从按钮升起一缕「汤气」 */
  function spawnSparks(anchor) {
    if (new URLSearchParams(location.search).get("reduced") === "1") return;
    var rect = anchor.getBoundingClientRect();
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    for (var i = 0; i < 5; i++) {
      var s = document.createElement("span");
      s.className = "spark " + (i % 2 ? "heart" : "round");
      s.style.left = (cx - 4 + (i - 2) * 7) + "px";
      s.style.top = (cy - 4) + "px";
      s.style.setProperty("--sx", ((i - 2) * 14) + "px");
      s.style.animationDelay = (i * 40) + "ms";
      if (i % 2) { s.innerHTML = ICONS.heart; s.style.width = "12px"; s.style.height = "12px"; s.style.background = "none"; }
      document.body.appendChild(s);
      (function (el) { setTimeout(function () { el.remove(); }, 900); })(s);
    }
  }

  /* ---------------- 主题系统 ---------------- */

  var THEMES = [
    { id: "xuanzhi",   name: "宣纸朱砂", tag: "默认 · 温润", dark: false, sw: ["#f5efe2", "#a5382c", "#b08a3e"], fg: "#f9f2e4" },
    { id: "duobamine", name: "多巴胺",   tag: "糖果活力",    dark: false, sw: ["#fff6ea", "#ff4f87", "#ffb100"], fg: "#ffffff" },
    { id: "qinghua",   name: "青花瓷",   tag: "瓷白钴蓝",    dark: false, sw: ["#f2f6fa", "#2861a8", "#3f9388"], fg: "#f4faff" },
    { id: "zhuying",   name: "竹影",     tag: "清新嫩绿",    dark: false, sw: ["#f1f6ec", "#2e9e63", "#b0973f"], fg: "#f4fbf6" },
    { id: "sunset",    name: "落日熔金", tag: "暖橙莓粉",    dark: false, sw: ["#fff3e6", "#ff6b2c", "#e04f7e"], fg: "#fff6ee" },
    { id: "starry",    name: "星夜蓝调", tag: "暗色 · 星光", dark: true,  sw: ["#141a2e", "#f0c04a", "#8f9dff"], fg: "#241d06" },
    { id: "cyber",     name: "赛博水墨", tag: "暗色 · 霓虹", dark: true,  sw: ["#101318", "#29d8e8", "#f26fb8"], fg: "#052a30" }
  ];
  var currentTheme = "starry"; /* 站点默认主题：星夜蓝调（与 index.html 防闪烁脚本的兜底一致） */

  function themeMeta(id) {
    return THEMES.find(function (t) { return t.id === id; }) || THEMES[0];
  }

  function applyFavicon(meta) {
    var link = document.getElementById("favicon");
    if (!link) return;
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='18' fill='" + meta.sw[1] + "'/><text x='50' y='68' font-size='58' text-anchor='middle' fill='" + meta.fg + "' font-family='KaiTi,STKaiti,serif' font-weight='bold'>汤</text></svg>";
    link.href = "data:image/svg+xml," + encodeURIComponent(svg);
  }

  function applyTheme(id, animate) {
    currentTheme = id;
    var meta = themeMeta(id);
    var root = document.documentElement;
    function paint() {
      root.setAttribute("data-theme", id);
      try { localStorage.setItem("csd_theme", id); } catch (e) {}
      applyFavicon(meta);
      var dot = document.querySelector(".theme-btn .tb-dot");
      if (dot) { dot.style.background = meta.sw[1]; dot.style.boxShadow = "-5px 0 0 -3px " + meta.sw[2]; }
    }
    if (animate && !reducedMotion) {
      root.classList.add("theme-fade");
      paint();
      setTimeout(function () { root.classList.remove("theme-fade"); }, 460);
      toast("主题 · " + meta.name);
    } else {
      paint();
    }
  }

  function hideThemePop() {
    var pop = document.getElementById("themePop");
    if (pop) pop.hidden = true;
    var btn = document.getElementById("themeBtn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function renderThemePop() {
    var grid = document.getElementById("tpGrid");
    if (!grid) return;
    grid.innerHTML = THEMES.map(function (t) {
      return '<button class="tp-item' + (t.id === currentTheme ? " active" : "") + '" data-tid="' + t.id + '" title="' + t.name + " · " + t.tag + '" aria-label="主题：' + t.name + '">' +
        '<span class="tp-sw">' + t.sw.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join("") + "</span>" +
        '<span class="tp-info"><span class="tp-name">' + t.name + '</span><span class="tp-tag">' + t.tag + "</span></span>" +
        '<span class="tp-check">' + icon("check") + "</span></button>";
    }).join("");
    grid.querySelectorAll(".tp-item").forEach(function (item) {
      item.addEventListener("click", function () {
        applyTheme(item.getAttribute("data-tid"), true);
        renderThemePop();
        hideThemePop();
      });
    });
  }

  function initTheme() {
    var saved = null;
    try {
      var qs = new URLSearchParams(location.search).get("theme");
      /* 无存储时回落到站点默认主题 starry（须与 index.html 防闪烁脚本一致） */
      saved = (qs && THEMES.some(function (t) { return t.id === qs; })) ? qs : (localStorage.getItem("csd_theme") || "starry");
    } catch (e) {}
    applyTheme(themeMeta(saved).id, false);
    renderThemePop();
    var btn = document.getElementById("themeBtn");
    var pop = document.getElementById("themePop");
    if (!btn || !pop) return;

    /* 交互改为 document 级 pointerdown 委托：比 click 更早触发，免疫双击开-关相抵与事件时序 edge case。
       防抖 300ms：连点/双击只算一次切换 */
    var lastToggle = 0;
    function togglePop() {
      var now = Date.now();
      if (now - lastToggle < 300) return;
      lastToggle = now;
      pop.hidden = !pop.hidden;
      btn.setAttribute("aria-expanded", String(!pop.hidden));
    }
    document.addEventListener("pointerdown", function (e) {
      if (e.target.closest("#themeBtn")) { e.preventDefault(); togglePop(); return; }
      var swatch = e.target.closest(".tp-item");
      if (swatch) {
        e.preventDefault();
        lastToggle = 0; /* 选中主题后允许立即再开弹层 */
        applyTheme(swatch.dataset.tid, true);
        renderThemePop();
        hideThemePop();
        return;
      }
      if (!e.target.closest("#themePop")) hideThemePop();
    });
    /* 键盘可达：Enter/Space 切换弹层 */
    btn.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePop(); }
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideThemePop(); });
  }

  /* ---------------- 路由 ---------------- */

  var routes = {};
  var currentRoute = "/";

  function parseRoute() {
    var h = location.hash.replace(/^#/, "") || "/";
    return h.split("?")[0];
  }

  function render() {
    var prevRoute = currentRoute;
    var prevScroll = window.scrollY;
    currentRoute = parseRoute();
    var routeChanged = prevRoute !== currentRoute;
    /* 进入毛选页时自动定位到今日语录所在卷 */
    if (currentRoute === "/maoxuan" && prevRoute !== "/maoxuan" && maoTodayRef) {
      maoState.vol = maoTodayRef.volIdx;
    }
    /* 进入三十六计页时自动定位到今日一计所在套 */
    if (currentRoute === "/sanshiliuji" && prevRoute !== "/sanshiliuji" && jiCats.length) {
      var tji = dailyOf("sanshiliuji");
      if (tji) {
        var tidN = Number(tji.id.split(":")[1]);
        jiCats.forEach(function (c, ci) {
          c.items.forEach(function (it) { if (it.id === tidN) jiState.cat = ci; });
        });
      }
    }
    document.querySelectorAll("#siteNav a").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-route") === currentRoute);
    });
    closeModal();
    var fn = routes[currentRoute] || routes["/"];
    app.innerHTML = "";
    fn(app);
    updateFavBadge();
    /* 只有跳转到新页面才回到顶部；同页内的操作（换一条/切主题/切卷/搜索/移出收藏）保持原位。
       用 instant 绕过 CSS smooth 滚动，避免滚动动画被重渲染的布局变化打断 */
    window.scrollTo({ top: routeChanged ? 0 : prevScroll, behavior: "instant" });
    app.classList.remove("page-in");
    void app.offsetWidth;
    app.classList.add("page-in");
    bindReveals(app);
    bindEffects(app);
  }

  /* ---------------- 微交互：聚光灯 / 3D 倾斜 / 磁吸 ---------------- */

  var finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  /* 动效不随系统 reduce 设置关闭（用户明确要求完整动效）；?reduced=1 仅作调试钩子 */
  var reducedMotion = new URLSearchParams(location.search).get("reduced") === "1";

  function bindEffects(root) {
    if (!finePointer || reducedMotion) return;
    /* 聚光灯：暖光随指针扫过纸面 */
    /* 聚光灯：暖光随指针扫过纸面 */
    root.querySelectorAll(".daily-card, .ji-card, .theme-card, .week-card").forEach(function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty("--mx", (e.clientX - r.left) + "px");
        card.style.setProperty("--my", (e.clientY - r.top) + "px");
      });
    });
    /* 今日大卡 3D 倾斜 */
    var daily = root.querySelector(".daily-card");
    if (daily && window.innerWidth > 760) {
      daily.addEventListener("pointermove", function (e) {
        var r = daily.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        daily.classList.add("is-tilting");
        daily.style.setProperty("--ry", (px * 3.2).toFixed(2) + "deg");
        daily.style.setProperty("--rx", (-py * 2.6).toFixed(2) + "deg");
      });
      daily.addEventListener("pointerleave", function () {
        daily.classList.remove("is-tilting");
        daily.style.setProperty("--ry", "0deg");
        daily.style.setProperty("--rx", "0deg");
      });
    }
    /* 磁吸按钮 */
    root.querySelectorAll(".daily-actions .btn, .m-acts .btn").forEach(function (btn) {
      btn.classList.add("magnetic");
      btn.addEventListener("pointermove", function (e) {
        var r = btn.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2);
        var dy = e.clientY - (r.top + r.height / 2);
        btn.style.setProperty("--tx", (dx * 0.16).toFixed(1) + "px");
        btn.style.setProperty("--ty", (dy * 0.22).toFixed(1) + "px");
      });
      btn.addEventListener("pointerleave", function () {
        btn.style.setProperty("--tx", "0px");
        btn.style.setProperty("--ty", "0px");
      });
    });
  }

  /* 朱砂涟漪：点击按钮时从落点扩散一圈 */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".btn");
    if (!btn || reducedMotion) return;
    if (!e.clientX && !e.clientY) return;
    var rect = btn.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height) * 1.1;
    var r = document.createElement("span");
    r.className = "ripple";
    r.style.width = r.style.height = size + "px";
    r.style.left = (e.clientX - rect.left - size / 2) + "px";
    r.style.top = (e.clientY - rect.top - size / 2) + "px";
    btn.appendChild(r);
    setTimeout(function () { r.remove(); }, 700);
  });

  /* 今日语录逐字书写（长度超限或弱动效时整段浮现） */
  function typeWrite(el) {
    if (reducedMotion || el.textContent.length > 120) {
      el.classList.add("is-writing");
      return;
    }
    var text = el.textContent;
    el.textContent = "";
    for (var i = 0; i < text.length; i++) {
      var span = document.createElement("span");
      span.className = "ch";
      span.textContent = text[i];
      span.style.setProperty("--d", Math.min(i * 26, 620) + "ms");
      el.appendChild(span);
    }
  }

  /* ---------------- 页面：今日 ---------------- */

  var homeState = { theme: "maoxuan", randomId: null };

  routes["/"] = function (root) {
    var now = new Date();
    var html = '';
    html += '<span class="hero-side left">每天一句</span><span class="hero-side right">好好生活</span>';
    html += '<section class="hero wrap">';
    html += '  <div class="hero-date"><span class="dash"></span><b>' + fmtDate(now) + "</b> · 星期" + WEEKDAYS[now.getDay()] + " · 第 " + dayOfYear(now) + " 天<span class=\"dash\"></span></div>";
    html += '  <h1 class="hero-title">今日 <span class="accent">鸡汤</span></h1>';
    html += '  <p style="color:var(--muted);letter-spacing:3px;font-size:14px">日子很长，喝口热汤</p>';
    html += '  <div class="theme-chips">';
    ["maoxuan", "sanshiliuji", "tiandao", "juexing"].forEach(function (t) {
      html += '<button class="chip' + (homeState.theme === t ? " active" : "") + '" data-theme="' + t + '"><span class="dot"></span>' + THEME_META[t].name + "</button>";
    });
    html += "  </div>";

    var isRandom = homeState.randomId != null;
    var q = isRandom
      ? flat[homeState.theme].find(function (x) { return x.id === homeState.randomId; }) || dailyOf(homeState.theme)
      : dailyOf(homeState.theme);

    if (!q) {
      html += '<div class="daily-card"><p class="empty-tip">内容筹备中，敬请期待…</p></div>';
    } else {
      html += '<div class="daily-card"><i class="beam" aria-hidden="true"></i>';
      html += '  <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span><span class="qmark">」</span>';
      html += '  <span class="today-pill">' + icon(isRandom ? "shuffle" : "sun") + (isRandom ? "随机一汤" : "今日一汤") + "</span>";
      if (q.title) html += '<div class="daily-title">' + esc(q.title) + "</div>";
      html += '  <p class="daily-text">' + esc(q.text) + "</p>";
      html += '  <p class="daily-source">—— <span class="src-name">' + esc(q.source) + "</span>" + (q.tag ? " <span class=\"tag\">" + esc(q.tag) + "</span>" : "") + "</p>";
      html += '  <div class="daily-actions">';
      html += '    <button class="btn btn-primary" data-act="copy">' + icon("copy") + "复制</button>";
      html += '    <button class="btn" data-act="random">' + icon("shuffle") + "换一条</button>";
      html += isRandom ? '    <button class="btn btn-ghost" data-act="today">' + icon("undo") + "回到今日</button>" : "";
      html += '    <button class="btn btn-ghost" data-act="fav">' + icon("heart") + (isFaved(q.id) ? "已收藏" : "收藏") + "</button>";
      html += "  </div>";
      html += "</div>";
    }
    html += "</section>";

    /* 主题入口 */
    html += '<section class="section wrap"><div class="sec-head reveal"><h2 class="sec-title">今日汤单</h2><span class="sec-sub">' + cnNum(Object.keys(THEME_META).length) + "大主题，随你挑选</span></div><div class=\"theme-grid\">";
    Object.keys(THEME_META).forEach(function (t) {
      var m = THEME_META[t];
      var cnt = flat[t].length;
      var extra = t === "maoxuan" ? maoCountsLabel() : (t === "sanshiliuji" ? "6 套 · 36 计全" : (t === "tiandao" ? "众生百态 · 十四句" : "开窍五阶"));
      html += '<a class="theme-card reveal" href="' + m.route + '"><span class="tc-bg">' + m.char + "</span>";
      html += "<h3>" + m.name + "</h3><p>" + m.desc + "</p>";
      html += '<span class="tc-meta"><span>' + extra + (t !== "sanshiliuji" ? " · 共 " + cnt + " 条" : "") + '</span><span class="go">进入品汤 ' + icon("arrow") + "</span></span></a>";
    });
    html += "</div></section>";

    /* 前七日：日课卷轴（复制一份实现无缝缓滚，悬停暂停细读） */
    html += '<section class="section wrap"><div class="sec-head reveal"><h2 class="sec-title">回味前七天</h2><span class="sec-sub">缓速巡游 · 悬停可细读 · 点击回看</span></div><div class="week-strip"><div class="week-track">';
    var weekCards = "";
    for (var i = 7; i >= 1; i--) {
      var ts = Date.now() - i * DAY_MS;
      var d = new Date(ts);
      var dq = dailyOf(homeState.theme, dayNum(ts));
      if (!dq) continue;
      weekCards += '<div class="week-card" data-ts="' + ts + '"><div class="wc-date"><span>' + fmtShort(d) + " 周" + WEEKDAYS[d.getDay()] + "</span><span class=\"wc-theme\">" + THEME_META[homeState.theme].name + "</span></div>";
      weekCards += '<div class="wc-text">' + (dq.title ? "【" + esc(dq.title) + "】" : "") + esc(dq.text) + "</div></div>";
    }
    html += weekCards + weekCards.replace('class="week-card"', 'class="week-card" aria-hidden="true"');
    html += "</div></div></section>";

    root.innerHTML = html;
    var dt = root.querySelector(".daily-text");
    if (dt) typeWrite(dt);

    root.querySelectorAll(".chip").forEach(function (c) {
      c.addEventListener("click", function () {
        homeState.theme = c.getAttribute("data-theme");
        homeState.randomId = null;
        render();
      });
    });
    var card = root.querySelector(".daily-card");
    if (card) {
      card.querySelector('[data-act="copy"]').addEventListener("click", function (e) { copyText(quoteCopyText(q), e.currentTarget); });
      card.querySelector('[data-act="random"]').addEventListener("click", function () {
        var pool = flat[homeState.theme];
        if (pool.length < 2) return;
        var r;
        do { r = pool[Math.floor(Math.random() * pool.length)]; } while (r.id === q.id);
        homeState.randomId = r.id;
        render();
      });
      var todayBtn = card.querySelector('[data-act="today"]');
      if (todayBtn) todayBtn.addEventListener("click", function () { homeState.randomId = null; render(); });
      card.querySelector('[data-act="fav"]').addEventListener("click", function (e) {
        var added = toggleFav(q, e.currentTarget);
        e.currentTarget.innerHTML = icon("heart") + (added ? "已收藏" : "收藏");
        e.currentTarget.classList.toggle("btn-primary", false);
      });
    }
    root.querySelectorAll(".week-card").forEach(function (w) {
      w.addEventListener("click", function () {
        var dq = dailyOf(homeState.theme, dayNum(Number(w.getAttribute("data-ts"))));
        if (dq) openQuoteModal(dq);
      });
    });
  };

  function maoCountsLabel() {
    var arts = 0;
    maoVolumes.forEach(function (v) { arts += v.articles.length; });
    return maoVolumes.length + " 卷 · " + arts + " 篇";
  }

  function openQuoteModal(q) {
    var html = '<div class="modal-mask" data-close="1"><div class="modal-card">';
    html += '<button class="m-close" data-close="1" aria-label="关闭">' + icon("close") + "</button>";
    html += '<div class="m-sub">' + THEME_META[q.theme].name + (q.tag ? " · " + esc(q.tag) : "") + "</div>";
    if (q.title) html += '<div class="m-title" style="font-size:26px;letter-spacing:8px">' + esc(q.title) + "</div>";
    html += '<p style="font-family:var(--font-kai);font-size:17px;line-height:2.1;margin:14px 0 10px">' + esc(q.text) + "</p>";
    html += '<p style="color:var(--muted);font-size:14px">—— ' + esc(q.source) + "</p>";
    html += '<div class="m-acts"><button class="btn btn-mini btn-primary" data-mact="copy">' + icon("copy") + "复制</button><button class=\"btn btn-mini btn-ghost\" data-mact=\"fav\">" + icon("heart") + (isFaved(q.id) ? "已收藏" : "收藏") + "</button>";
    html += '<a class="btn btn-mini btn-ghost" href="' + THEME_META[q.theme].route + '" data-close="1">前往主题 ' + icon("arrow") + "</a></div>";
    html += "</div></div>";
    modalRoot.innerHTML = html;
    modalRoot.querySelectorAll("[data-close]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        if (e.target === el || el.classList.contains("m-close")) closeModal();
      });
    });
    modalRoot.querySelector('[data-mact="copy"]').addEventListener("click", function (e) { copyText(quoteCopyText(q), e.currentTarget); });
    modalRoot.querySelector('[data-mact="fav"]').addEventListener("click", function (e) {
      var added = toggleFav(q, e.currentTarget);
      e.currentTarget.innerHTML = icon("heart") + (added ? "已收藏" : "收藏");
    });
  }
  function closeModal() {
    var mask = modalRoot.querySelector(".modal-mask");
    if (!mask) return;
    mask.classList.add("closing");
    setTimeout(function () { if (mask.parentNode) mask.remove(); }, 190);
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

  /* ---------------- 页面：毛选 ---------------- */

  var maoState = { vol: 0, q: "" };

  routes["/maoxuan"] = function (root) {
    if (!maoVolumes.length) { root.innerHTML = '<p class="empty-tip" style="padding-top:120px">毛选语录整理中，敬请期待…</p>'; return; }
    var html = '<section class="page-head wrap">';
    html += '<h1 class="page-title">毛选语录</h1>';
    html += '<p class="page-desc">《毛泽东选集》四卷经典语录，按原文篇目编排，末附诗词名句。<br>实事求是，有的放矢；天天读一句，胜读十年书。</p>';
    html += '<div class="page-stats"><div class="stat"><b>' + maoVolumes.length + "</b><span>卷 册</span></div><div class=\"stat\"><b>" + maoArticles() + "</b><span>篇 目</span></div><div class=\"stat\"><b>" + flat.maoxuan.length + "</b><span>条 语录</span></div></div>";
    html += '<div class="search-bar"><input id="maoSearch" type="search" placeholder="搜一篇、搜一句… 试试：实事求是 / 愚公移山" value="' + esc(maoState.q) + '"><span class="search-ico">' + icon("search") + "</span></div>";
    html += "</section>";

    if (maoState.q) {
      html += renderMaoSearch();
    } else {
      html += '<section class="wrap"><div class="vol-tabs">';
      maoVolumes.forEach(function (v, i) {
        html += '<button class="vol-tab' + (i === maoState.vol ? " active" : "") + '" data-vol="' + i + '">' + v.name + "</button>";
      });
      html += '</div><div class="vol-period">' + esc(maoVolumes[maoState.vol].period) + "</div>";
      html += '<div class="article-list">' + renderMaoVolume(maoState.vol) + "</div></section>";
    }
    root.innerHTML = html;

    var input = root.querySelector("#maoSearch");
    input.addEventListener("input", function () {
      maoState.q = input.value.trim();
      clearTimeout(input._t);
      input._t = setTimeout(function () {
        render();
        var el = document.getElementById("maoSearch");
        /* preventScroll：避免 focus 把顶部的搜索框滚进视口，破坏保持的滚动位置 */
        el.focus({ preventScroll: true });
        el.setSelectionRange(el.value.length, el.value.length);
      }, 260);
    });
    root.querySelectorAll(".vol-tab").forEach(function (t) {
      t.addEventListener("click", function () { maoState.vol = Number(t.getAttribute("data-vol")); maoState.q = ""; render(); });
    });
    bindArticleToggles(root);
  };

  function maoArticles() {
    var n = 0;
    maoVolumes.forEach(function (v) { n += v.articles.length; });
    return n;
  }

  function todayQuoteId() {
    var q = dailyOf("maoxuan");
    return q ? q.id : null;
  }

  function renderMaoVolume(vi) {
    var vol = maoVolumes[vi];
    var tid = todayQuoteId();
    var html = "";
    vol.articles.forEach(function (art, ai) {
      var hasToday = art.quotes.some(function (qq, qi) { return "maoxuan:" + vi + ":" + ai + ":" + qi === tid; });
      html += '<div class="article-item' + (hasToday ? " open today-item" : "") + '" data-ai="' + ai + '">';
      html += '<button class="article-head" aria-expanded="false"><span class="a-date">' + esc(art.date) + '</span><span class="a-title">' + esc(art.title) + '</span><span class="a-count">' + art.quotes.length + " 条</span><span class=\"a-arrow\">" + icon("chevron") + "</span></button>";
      html += '<div class="article-body' + (hasToday ? '" style="height:auto"' : '"') + '><div class="article-body-inner">' + art.quotes.map(function (qq, qi) {
        var id = "maoxuan:" + vi + ":" + ai + ":" + qi;
        var isT = id === tid;
        var s = '<div class="quote-row' + (isT ? " q-today" : "") + '" data-qid="' + id + '"><p class="q-text">' + esc(qq.text) + "</p>";
        s += '<div class="q-foot">' + (isT ? '<span class="today-pill">' + icon("sun") + "今日</span>" : "") + (qq.tag ? '<span class="tag">' + esc(qq.tag) + "</span>" : "");
        s += '<span class="q-acts">' + iconBtn("", "copy", "复制") + iconBtn("fav-toggle", "heart", "收藏", isFaved(id) ? " faved" : "") + "</span></div></div>";
        return s;
      }).join("") + "</div></div></div>";
    });
    return html;
  }

  function renderMaoSearch() {
    var kw = maoState.q.toLowerCase();
    var tid = todayQuoteId();
    var hits = [];
    flat.maoxuan.forEach(function (q) {
      if ((q.text + q.sourceTitle + q.source + (q.tag || "")).toLowerCase().indexOf(kw) >= 0) hits.push(q);
    });
    var html = '<section class="wrap"><div class="vol-period">搜索到 ' + hits.length + ' 条与「' + esc(maoState.q) + '」相关</div><div class="article-list">';
    if (!hits.length) return html + '<p class="empty-tip">没有找到相关语录，换个词试试</p></div></section>';
    hits.slice(0, 60).forEach(function (q) {
      html += '<div class="article-item open"><div style="padding:14px 22px 6px"><span class="a-date" style="font-size:12px;color:var(--gold)">' + esc(q.source) + '</span></div><div class="article-body" style="height:auto"><div class="article-body-inner">';
      html += '<div style="padding:0 22px 18px"><div class="quote-row' + (q.id === tid ? " q-today" : "") + '" data-qid="' + q.id + '"><p class="q-text">' + esc(q.text) + '</p><div class="q-foot">' + (q.id === tid ? '<span class="today-pill">' + icon("sun") + "今日</span>" : "") + (q.tag ? '<span class="tag">' + esc(q.tag) + "</span>" : "") + '<span class="q-acts">' + iconBtn("", "copy", "复制") + iconBtn("fav-toggle", "heart", "收藏", isFaved(q.id) ? " faved" : "") + "</span></div></div></div></div></div>";
    });
    if (hits.length > 60) html += '<p class="empty-tip">仅显示前 60 条，请输入更具体的关键词</p>';
    return html + "</div></section>";
  }

  /* 手风琴：状态同步设置（class+inline 终值即时生效，永不卡壳），动画仅作视觉重放。
     后台标签页 rAF/WAAPI/transition 都可能冻结在第一帧——检测到动画未推进时立即放弃动画露出终态 */
  function playHeightAnim(body, from, to) {
    var a = body.animate([{ height: from + "px" }, { height: to + "px" }], { duration: 380, easing: "cubic-bezier(0.16,1,0.3,1)" });
    body._anim = a;
    a.onfinish = function () { if (body._anim === a) body._anim = null; };
    setTimeout(function () {
      /* 前台 120ms 时 currentTime 应已推进；后台冻结时 currentTime 停在 0 → 放弃动画露出终态 */
      if (body._anim === a && (typeof a.currentTime !== "number" || a.currentTime < 10)) {
        try { a.cancel(); } catch (e) {}
        body._anim = null;
      }
    }, 120);
  }
  function toggleArticle(item, head) {
    var body = item.querySelector(".article-body");
    var inner = body.querySelector(".article-body-inner");
    if (!body || !inner) return;
    var isOpen = item.classList.contains("open");
    var reduced = new URLSearchParams(location.search).get("reduced") === "1";
    var noAnim = reduced || !body.animate;
    if (body._anim) { try { body._anim.cancel(); } catch (e) {} body._anim = null; }

    if (isOpen) {
      var from = body.offsetHeight; /* 收起前当前高度（auto 下实测） */
      item.classList.remove("open");
      head.setAttribute("aria-expanded", "false");
      body.style.height = "0px"; /* 终态同步生效 */
      if (noAnim || from < 4) return;
      playHeightAnim(body, from, 0);
    } else {
      item.classList.add("open");
      head.setAttribute("aria-expanded", "true");
      body.style.height = "auto"; /* 终态同步生效 */
      var to = inner.scrollHeight; /* auto 态下实测内容高度 */
      if (noAnim || to < 4) return;
      playHeightAnim(body, 0, to);
    }
  }

  function bindArticleToggles(root) {
    root.querySelectorAll(".article-head").forEach(function (h) {
      h.addEventListener("click", function () {
        toggleArticle(h.closest(".article-item"), h);
      });
    });
    root.querySelectorAll(".quote-row[data-qid]").forEach(function (row) {
      var q = flat.maoxuan.find(function (x) { return x.id === row.getAttribute("data-qid"); });
      if (!q) return;
      var btns = row.querySelectorAll(".icon-btn");
      btns[0].addEventListener("click", function (e) { copyText(quoteCopyText(q), e.currentTarget); });
      if (btns[1]) btns[1].addEventListener("click", function (e) {
        var added = toggleFav(q, e.currentTarget);
        btns[1].classList.toggle("faved", added);
      });
    });
  }

  /* ---------------- 页面：三十六计 ---------------- */

  var jiState = { cat: 0 };

  routes["/sanshiliuji"] = function (root) {
    if (!jiCats.length) { root.innerHTML = '<p class="empty-tip" style="padding-top:120px">三十六计整理中，敬请期待…</p>'; return; }
    /* 进入页面时自动定位到今日一计所在套（与毛选页同理） */
    var d = window.SSJJ_DATA || {};
    var html = '<section class="page-head wrap">';
    html += '<h1 class="page-title">三十六计</h1>';
    html += '<p class="page-desc">' + esc(d.intro || "中国古代三十六个兵法策略，六套成书，谋略经典。") + "</p>";
    html += '<div class="page-stats"><div class="stat"><b>6</b><span>套</span></div><div class="stat"><b>36</b><span>计</span></div><div class="stat"><b>' + flat.sanshiliuji.length + "</b><span>条全录</span></div></div>";
    html += "</section>";

    html += '<section class="wrap"><div class="cat-tabs">';
    jiCats.forEach(function (c, i) {
      html += '<button class="vol-tab' + (i === jiState.cat ? " active" : "") + '" data-cat="' + i + '">' + c.name + "</button>";
    });
    html += '</div><div class="cat-desc">' + esc(jiCats[jiState.cat].desc) + "</div>";

    var tid = dailyOf("sanshiliuji");
    var tidNum = tid ? Number(tid.id.split(":")[1]) : -1;
    html += '<div class="ji-grid">';
    jiCats[jiState.cat].items.forEach(function (it) {
      var isT = it.id === tidNum;
      html += '<div class="ji-card' + (isT ? " ji-today" : "") + '" data-jid="' + it.id + '">';
      html += '<span class="j-id' + (isT ? " today" : "") + '">' + (isT ? icon("sun") + "今日一计" : cnNum(it.id)) + "</span>";
      html += '<div class="j-name">' + esc(it.name) + "</div>";
      html += '<p class="j-essence">' + esc(it.essence) + "</p>";
      html += '<span class="j-more">品读此计 ' + icon("arrow") + "</span></div>";
    });
    html += "</div></section>";
    root.innerHTML = html;

    root.querySelectorAll(".vol-tab").forEach(function (t) {
      t.addEventListener("click", function () { jiState.cat = Number(t.getAttribute("data-cat")); render(); });
    });
    root.querySelectorAll(".ji-card").forEach(function (c) {
      c.addEventListener("click", function () {
        var id = Number(c.getAttribute("data-jid"));
        var item = null;
        jiCats.forEach(function (cat) { var f = cat.items.find(function (x) { return x.id === id; }); if (f) item = f; });
        if (item) openJiModal(item);
      });
    });
  };

  function openJiModal(it) {
    var html = '<div class="modal-mask" data-close="1"><div class="modal-card">';
    html += '<button class="m-close" data-close="1" aria-label="关闭">' + icon("close") + "</button>";
    html += '<div class="m-sub">《三十六计》 · ' + esc(it.cat) + " · 第" + it.id + "计</div>";
    html += '<div class="m-title">' + esc(it.name) + "</div>";
    html += '<div class="m-block p-original" style="margin-top:14px"><h4>原 文</h4><p>' + esc(it.original) + "</p></div>";
    html += '<div class="m-block"><h4>释 义</h4><p>' + esc(it.meaning) + "</p></div>";
    if (it.example) html += '<div class="m-block"><h4>典 故</h4><p>' + esc(it.example) + "</p></div>";
    html += '<div class="m-acts"><button class="btn btn-mini btn-primary" data-mact="copy">' + icon("copy") + "复制此计</button><button class=\"btn btn-mini btn-ghost\" data-mact=\"fav\">" + icon("heart") + (isFaved(it.model.id) ? "已收藏" : "收藏") + "</button></div>";
    html += "</div></div>";
    modalRoot.innerHTML = html;
    modalRoot.querySelectorAll("[data-close]").forEach(function (el) {
      el.addEventListener("click", function (e) { if (e.target === el || el.classList.contains("m-close")) closeModal(); });
    });
    modalRoot.querySelector('[data-mact="copy"]').addEventListener("click", function (e) {
      copyText("第" + it.id + "计 · " + it.name + "\n【原文】" + it.original + "\n【释义】" + it.meaning + (it.example ? "\n【典故】" + it.example : "") + "\n——《三十六计》", e.currentTarget);
    });
    modalRoot.querySelector('[data-mact="fav"]').addEventListener("click", function (e) {
      var added = toggleFav(it.model, e.currentTarget);
      e.currentTarget.innerHTML = icon("heart") + (added ? "已收藏" : "收藏");
    });
  }

  /* ---------------- 页面：天道众生相 ---------------- */

  routes["/tiandao"] = function (root) {
    var d = window.TIANDAO_DATA || {};
    var tid = dailyOf("tiandao");
    var html = '<section class="page-head wrap">';
    html += '<h1 class="page-title">天道众生相</h1>';
    html += '<p class="page-desc">电视剧《天道》· 王志文 饰 丁元英 · 改编自小说《遥远的救世主》<br>' + esc(d.intro || "") + "</p>";
    html += '<div class="page-stats"><div class="stat"><b>4</b><span>辑</span></div><div class="stat"><b>' + flat.tiandao.length + '</b><span>句</span></div><div class="stat"><b>1</b><span>段出圈</span></div></div>';
    html += "</section>";

    /* 出圈一段：全站唯一深墨底「夜读」卡 */
    if (d.highlight) {
      var h = d.highlight;
      html += '<section class="wrap" style="margin-bottom:44px"><div class="dark-scroll reveal">';
      html += '<div class="ds-head"><span class="ds-tag">' + icon("sun") + '此段出圈</span><span class="ds-title">' + esc(h.title) + "</span></div>";
      html += '<div class="ds-lines">' + h.lines.map(function (ln, i) {
        return '<p class="ds-line" style="animation-delay:' + (i * 130) + 'ms">' + esc(ln) + "</p>";
      }).join("") + "</div>";
      html += '<div class="ds-foot"><span>—— ' + esc(h.source) + "</span>";
      html += '<span class="q-acts"><button class="icon-btn icon-btn-dark" data-dscopy title="复制此段" aria-label="复制此段">' + icon("copy") + "</button></span></div>";
      if (h.note) html += '<p class="ds-note">' + esc(h.note) + "</p>";
      html += "</div></section>";
    }

    /* 分辑台词 */
    (d.groups || []).forEach(function (g, gi) {
      html += '<section class="section wrap" style="padding-top:10px"><div class="sec-head reveal"><h2 class="sec-title">' + esc(g.name) + '</h2><span class="sec-sub">' + esc(g.desc || "") + "</span></div>";
      html += '<div class="td-list">';
      g.quotes.forEach(function (q, qi) {
        var id = "tiandao:" + gi + ":" + qi;
        var isT = tid && tid.id === id;
        html += '<div class="quote-row td-row reveal' + (isT ? " q-today" : "") + '" data-qid="' + id + '"><p class="q-text">' + esc(q.text) + "</p>";
        html += '<div class="q-foot">' + (isT ? '<span class="today-pill">' + icon("sun") + "今日</span>" : "") + (q.source ? '<span class="td-src">' + esc(q.source) + "</span>" : "") + (q.tag ? '<span class="tag">' + esc(q.tag) + "</span>" : "");
        html += '<span class="q-acts">' + iconBtn("", "copy", "复制") + iconBtn("fav-toggle", "heart", "收藏", isFaved(id) ? " faved" : "") + "</span></div></div>";
      });
      html += "</div></section>";
    });
    root.innerHTML = html;

    var darkCopy = root.querySelector("[data-dscopy]");
    if (darkCopy && d.highlight) {
      darkCopy.addEventListener("click", function (e) {
        copyText(d.highlight.lines.join("\n") + "\n—— " + d.highlight.source, e.currentTarget);
      });
    }
    root.querySelectorAll(".quote-row[data-qid]").forEach(function (row) {
      var q = flat.tiandao.find(function (x) { return x.id === row.getAttribute("data-qid"); });
      if (!q) return;
      var btns = row.querySelectorAll(".icon-btn");
      btns[0].addEventListener("click", function (e) { copyText(quoteCopyText(q), e.currentTarget); });
      if (btns[1]) btns[1].addEventListener("click", function (e) {
        var added = toggleFav(q, e.currentTarget);
        btns[1].classList.toggle("faved", added);
      });
    });
  };

  /* ---------------- 页面：自我觉醒 ---------------- */

  routes["/juexing"] = function (root) {
    var d = window.JUEXING_DATA || {};
    var tid = dailyOf("juexing");
    var html = '<section class="page-head wrap">';
    html += '<h1 class="page-title">自我觉醒</h1>';
    html += '<p class="page-desc">人生要开五次窍：祛魅 · 忘情 · 归已 · 泯生 · 回归<br>开到第五次，才算真正活明白。</p>';
    html += '<div class="page-stats"><div class="stat"><b>5</b><span>次开窍</span></div><div class="stat"><b>' + flat.juexing.length + "</b><span>条 觉悟</span></div></div>";
    html += "</section>";

    html += '<section class="wrap"><p class="awaken-intro">“' + esc(d.intro || "") + '”</p>';
    html += '<div class="awaken-timeline">';
    awakenStages.forEach(function (s, si) {
      var isT = tid && tid.ref.stageIdx === si;
      html += '<div class="stage-item reveal"><span class="stage-node"></span><div class="stage-card' + (isT ? " today-item" : "") + '">';
      html += '<div class="stage-head"><span class="stage-no">第' + cnNum(si + 1) + "窍 · " + s.no + '</span><span class="stage-name">' + esc(s.name) + '</span><span class="stage-label">' + esc(s.label) + (isT ? ' · <span style="color:var(--cinnabar)">今日之悟</span>' : "") + "</span></div>";
      html += '<p class="stage-text">' + esc(s.text) + "</p>";
      html += '<div class="stage-note">' + esc(s.note) + "</div>";
      html += '<div class="stage-foot">' + (s.tag ? '<span class="tag">' + esc(s.tag) + "</span>" : "") + '<span class="q-acts">' + iconBtn("", "copy", "复制") + iconBtn("fav-toggle", "heart", "收藏", isFaved("juexing:" + si) ? " faved" : "") + "</span></div>";
      html += "</div></div>";
    });
    html += "</div>";

    if (d.image) {
      html += '<figure class="origin-figure reveal"><div class="phone-frame"><img src="' + esc(d.image) + '" alt="' + esc(d.imageCaption || "灵感原图") + '" loading="lazy"></div>';
      html += "<figcaption>" + esc(d.imageCaption || "灵感原图") + " · " + esc(d.source || "") + "</figcaption></figure>";
    }
    html += "</section>";
    root.innerHTML = html;
    bindTracingBeam(root.querySelector(".awaken-timeline"));

    root.querySelectorAll(".stage-card").forEach(function (card, si) {
      var btns = card.querySelectorAll(".icon-btn");
      var stage = awakenStages[si];
      btns[0].addEventListener("click", function (e) {
        copyText("「" + stage.text + "」\n—— " + d.source + " · " + stage.label + "「" + stage.name + "」", e.currentTarget);
      });
      btns[1].addEventListener("click", function (e) {
        var q = flat.juexing[si];
        var added = toggleFav(q, e.currentTarget);
        btns[1].classList.toggle("faved", added);
      });
    });
  };

  /* 滚动墨线：线随阅读生长，读尽时笔锋点亮。
     用时间戳节流而非 rAF——后台标签页 rAF 冻结会导致进度永不更新 */
  function bindTracingBeam(timeline) {
    if (!timeline) return;
    var fill = document.createElement("span");
    fill.className = "beam-fill";
    var tip = document.createElement("span");
    tip.className = "beam-tip";
    timeline.appendChild(fill);
    timeline.appendChild(tip);
    var last = 0;
    function update() {
      var rect = timeline.getBoundingClientRect();
      var mid = window.innerHeight * 0.55;
      var p = (mid - rect.top) / rect.height;
      p = Math.max(0, Math.min(1, p));
      fill.style.setProperty("--p", p.toFixed(4));
      tip.style.setProperty("--p", p.toFixed(4));
      tip.classList.toggle("lit", p >= 0.985);
    }
    function onScroll() {
      var now = Date.now();
      if (now - last < 40) return;
      last = now;
      update();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }

  /* ---------------- 页面：收藏 ---------------- */

  routes["/favs"] = function (root) {
    var list = favs();
    var html = '<section class="page-head wrap">';
    html += '<h1 class="page-title">我的汤碗</h1>';
    html += '<p class="page-desc">收藏的句子都在这里，温一温再喝。</p></section>';
    html += '<section class="wrap"><div class="fav-list">';
    if (!list.length) {
      html += '<div class="favs-empty">';
      html += '<svg class="bowl-svg" viewBox="0 0 120 110" aria-hidden="true">';
      html += '<g class="steam" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".7">';
      html += '<path d="M42 38 C38 30 46 26 42 18"/><path d="M60 34 C56 26 64 22 60 14"/><path d="M78 38 C74 30 82 26 78 18"/>';
      html += "</g>";
      html += '<path d="M18 56 h84 a42 30 0 0 1 -30 40 h-24 a42 30 0 0 1 -30 -40z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>';
      html += '<path d="M14 56 h92" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>';
      html += '<path d="M46 96 h28" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>';
      html += "</svg>";
      html += '<p>汤碗还空着<br>看到对味的句子，点一下 ' + icon("heart") + ' 收进来</p>';
      html += "</div>";
    } else {
      list.forEach(function (f) {
        var themeName = THEME_META[f.theme] ? THEME_META[f.theme].name : f.theme;
        html += '<div class="fav-item reveal" data-fid="' + esc(f.id) + '"><div class="f-theme">' + esc(themeName) + " · " + new Date(f.savedAt).toLocaleDateString("zh-CN") + '</div><p class="f-text">' + (f.title ? "【" + esc(f.title) + "】" : "") + esc(f.text) + '</p><div class="f-foot"><span class="f-src">—— ' + esc(f.source || "") + '</span><span class="q-acts"><button class="icon-btn" data-fcopy title="复制" aria-label="复制">' + icon("copy") + '</button><button class="icon-btn faved" data-fdel title="移出" aria-label="移出">' + icon("heart") + "</button></span></div></div>";
      });
    }
    html += "</div></section>";
    root.innerHTML = html;

    root.querySelectorAll(".fav-item").forEach(function (item) {
      item.querySelector("[data-fcopy]").addEventListener("click", function (e) {
        copyText("「" + item.querySelector(".f-text").textContent + "」\n—— " + item.querySelector(".f-src").textContent.replace(/^——\s*/, ""), e.currentTarget);
      });
      item.querySelector("[data-fdel]").addEventListener("click", function () {
        var fid = item.getAttribute("data-fid");
        saveFavs(favs().filter(function (x) { return x.id !== fid; }));
        updateFavBadge();
        render();
        toast("已从汤碗移出");
      });
    });
  };

  /* ---------------- 启动 ---------------- */

  buildMao();
  buildJi();
  buildTiandao();
  buildJuexing();

  (function () {
    var tid = dailyOf("maoxuan");
    if (!tid) return;
    var p = tid.id.split(":");
    maoTodayRef = { volIdx: Number(p[1]), artIdx: Number(p[2]), quoteIdx: Number(p[3]) };
  })();

  document.getElementById("footStats").textContent =
    "现熬毛选语录 " + flat.maoxuan.length + " 条 · 三十六计 36 计 · 天道众生 " + flat.tiandao.length + " 句 · 觉醒五窍 " + flat.juexing.length + " 条";

  /* 先保证主功能上线：路由与渲染优先，主题系统出错也不拖垮页面 */
  window.addEventListener("hashchange", render);
  render();
  try { initTheme(); } catch (e) { /* 主题初始化失败不影响主功能 */
    document.querySelectorAll(".theme-btn, .theme-pop").forEach(function (el) { el.style.display = "none"; });
  }
})();
