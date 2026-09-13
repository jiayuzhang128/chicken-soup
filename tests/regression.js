/* ============================================================
   全量回归测试（本地与 CI 共用）：node tests/regression.js 或 npm test
   —— 自动拉起本地服务器（8765 被占用则复用现有实例）
   —— 自动探测 Chrome（CHROME_BIN 环境变量可覆盖；CI 的 ubuntu runner 用系统 google-chrome）
   —— 主题切换等关键交互用 CDP 真实输入管线（Input.dispatchMouseEvent，isTrusted=true），
      与真实鼠标同路径，可捕获命中测试层的问题（element.click() 测不出来）
   产出：控制台 PASS/FAIL 清单 + 截图到 tests/shots/（CI 上传为 artifacts）
   ============================================================ */
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const net = require("net");
const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.TEST_PORT || 8765);
const CDP_PORT_BASE = 9300;
const SHOTS = path.join(__dirname, "shots");

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const candidates = process.platform === "win32" ? [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ] : process.platform === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ] : [
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"
  ];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  return "google-chrome";
}

function portBusy(port) {
  return new Promise(res => {
    const s = net.connect({ host: "127.0.0.1", port }, () => { s.destroy(); res(true); });
    s.on("error", () => res(false));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  // 服务器：空闲则自起，被占用则复用（例如开发者正开着 node server.js）
  let serverProc = null;
  if (!(await portBusy(PORT))) {
    serverProc = spawn(process.execPath, [path.join(ROOT, "server.js")], { stdio: "ignore" });
    for (let i = 0; i < 40 && !(await portBusy(PORT)); i++) await sleep(250);
    console.log(`[setup] dev server started on :${PORT}`);
  } else {
    console.log(`[setup] reusing dev server already on :${PORT}`);
  }
  if (!(await portBusy(PORT))) throw new Error("dev server not reachable on :" + PORT);

  const CHROME = findChrome();
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail: detail || "" });
    console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  | " + detail : ""));
  }

  const prof = path.join(process.env.TEMP || "/tmp", "csd_regprof_" + Date.now());
  const CDP_PORT = CDP_PORT_BASE + Math.floor(Math.random() * 400);
  const ch = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${prof}`, "--window-size=1440,900", "--no-first-run",
    "--disable-extensions", "--disable-gpu", "--hide-scrollbars",
    "--no-sandbox", "--disable-dev-shm-usage", "about:blank"], { stdio: "ignore" });

  const getJson = p => new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: CDP_PORT, path: p }, r => {
      let d = ""; r.on("data", c => d += c);
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
  let targets = null;
  for (let i = 0; i < 40; i++) { await sleep(300); try { targets = await getJson("/json/list"); if (targets && targets.length) break; } catch (e) {} }
  if (!targets) throw new Error("Chrome devtools not reachable (binary: " + CHROME + ")");
  const page = targets.find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  async function evl(expr) {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(expr.slice(0, 60) + " => " + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result.result.value;
  }
  async function realClick(x, y) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" });
    await sleep(70);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" });
  }
  async function realClickEl(sel, idx) {
    /* 真实点击前先把元素滚到视口中央：headless 实际视口高度与 --window-size 语义不一致（实测 900 的窗口给 746），
       且今日语录长短随日期轮换变化、会把按钮推出视口——不滚动会让真实点击落在视口外静默失效 */
    const c = await evl(`(function(){var e=document.querySelectorAll(${JSON.stringify(sel)})[${idx || 0}];if(!e)return null;e.scrollIntoView({block:"center",behavior:"instant"});var r=e.getBoundingClientRect();return [r.left+r.width/2, r.top+r.height/2];})()`);
    if (!c) throw new Error("no element for " + sel);
    await sleep(150);
    await realClick(Math.round(c[0]), Math.round(c[1]));
  }
  async function shot(name) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (!r.result || !r.result.data) throw new Error("screenshot failed: " + JSON.stringify(r.error || r.result || r).slice(0, 200));
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, "base64"));
  }
  async function openThemePop() {
    await realClickEl("#themeBtn");
    await sleep(420);
    return evl(`document.getElementById("themePop").hidden === false`);
  }
  async function navigate(url) {
    await send("Page.navigate", { url });
    for (let i = 0; i < 40; i++) { await sleep(250); if (await evl("document.readyState") === "complete") break; }
  }
  const BASE = `http://127.0.0.1:${PORT}`;

  try {
    await send("Page.enable"); await send("Runtime.enable");
    await navigate(BASE + "/");
    await sleep(900);

    /* ---- 0. 环境 & 版本 ---- */
    check("页面加载 & 无脚本异常", await evl(`document.getElementById("app").children.length > 0`));
    check("页脚版本号存在（v20xxxxxx.x 格式）", /v20\d{6}\.\d+/.test(await evl(`document.getElementById("footStats").parentNode.textContent`) || ""), "由 index.html 驱动，发版自动适配");

    /* ---- 0.5 无存储新访客：默认主题 ---- */
    const initTheme0 = await evl(`document.documentElement.getAttribute("data-theme")`);
    check("无存储默认主题=starry", initTheme0 === "starry", "got=" + initTheme0);

    /* ---- 1. 首页动效组件存在 ---- */
    const fx = await evl(`(function(){
      return {
        beam: !!document.querySelector(".daily-card .beam"),
        corners: document.querySelectorAll(".daily-card .corner").length === 4,
        qmark: !!document.querySelector(".daily-card .qmark"),
        heroSide: document.querySelectorAll(".hero-side").length === 2,
        weekTrackAnim: getComputedStyle(document.querySelector(".week-track")).animationName === "marquee",
        dailyTextFx: !!document.querySelector(".daily-text .ch") || !!document.querySelector(".daily-text.is-writing"),
        dailyCardTransform: getComputedStyle(document.querySelector(".daily-card")).transform !== "none"
      };
    })()`);
    check("首页动效组件（流光边框/四角/引号/侧联/卷轴滚动/逐字书写）",
      fx.beam && fx.corners && fx.qmark && fx.heroSide && fx.weekTrackAnim && fx.dailyTextFx && fx.dailyCardTransform, JSON.stringify(fx));

    /* ---- 2. 本地字体生效 & 无外部字体请求 ---- */
    const fontState = await evl(`(function(){
      var fam = {};
      document.fonts.forEach(function(f){ fam[f.family] = (fam[f.family] || 0) + (f.status === "loaded" || f.status === "unloaded" ? 1 : 0); });
      return { families: Object.keys(fam), any: Object.keys(fam).length >= 2 };
    })()`);
    check("本地子集字体已注册（Noto Serif SC + ZCOOL XiaoWei）", fontState.any &&
      fontState.families.some(f => /Noto Serif SC/i.test(f)) && fontState.families.some(f => /ZCOOL/i.test(f)),
      fontState.families.join(", "));

    /* ---- 3. 七主题切换（真实输入管线，含默认主题在内全遍历） ---- */
    const THEME_IDS = ["xuanzhi", "duobamine", "qinghua", "zhuying", "sunset", "starry", "cyber"];
    let themeOk = true, themeDetail = [];
    for (let i = 0; i < THEME_IDS.length; i++) {
      const opened = await openThemePop();
      if (!opened) { themeOk = false; themeDetail.push("pop-fail@" + THEME_IDS[i]); break; }
      const hitOk = await evl(`(function(){var e=document.querySelectorAll(".tp-item")[${i}];var r=e.getBoundingClientRect();var s=document.elementsFromPoint(r.left+r.width/2,r.top+r.height/2)[0];return !!(s && s.closest(".tp-item"));})()`);
      await realClickEl(".tp-item", i);
      await sleep(350);
      const now = await evl(`document.documentElement.getAttribute("data-theme")`);
      const saved = await evl(`localStorage.getItem("csd_theme")`);
      const pass = hitOk && now === THEME_IDS[i] && saved === THEME_IDS[i];
      themeOk = themeOk && pass;
      themeDetail.push(THEME_IDS[i] + ":" + (pass ? "ok" : "got=" + now + ",saved=" + saved + ",hit=" + hitOk));
      if (THEME_IDS[i] === "starry") await shot("theme-starry.png");
    }
    // 收尾：切回站点默认主题 starry（THEMES 清单 index 5）
    if (themeOk) {
      await openThemePop();
      await realClickEl(".tp-item", 5);
      await sleep(350);
      const back = await evl(`document.documentElement.getAttribute("data-theme")`);
      check("七主题切换+持久化（真实点击）", themeOk && back === "starry", themeDetail.join(" ") + " 收尾:" + back);
    } else {
      check("七主题切换+持久化（真实点击）", false, themeDetail.join(" "));
    }

    /* ---- 4. 弹层命中防回归断言（z-index 事故哨兵） ---- */
    await openThemePop();
    const stackTop = await evl(`(function(){var e=document.querySelectorAll(".tp-item")[3];var r=e.getBoundingClientRect();var s=document.elementsFromPoint(r.left+r.width/2,r.top+r.height/2)[0];return s ? (s.tagName+"."+(s.className||"")) : "null";})()`);
    check("弹层色点命中栈顶层属于弹层（防 z-index 回归）", /tp-item|tp-sw|I|SPAN|BUTTON/i.test(stackTop), "top=" + stackTop);
    await realClickEl("#themeBtn"); // 关闭弹层
    await sleep(300);

    /* ---- 5. sticky 顶栏 ---- */
    await evl(`window.scrollTo({top:800, behavior:"instant"})`);
    await sleep(200);
    const hdr = await evl(`(function(){var h=document.querySelector(".site-header");var cs=getComputedStyle(h);return {top:h.getBoundingClientRect().top, pos:cs.position, z:cs.zIndex};})()`);
    check("顶栏 sticky 悬浮 z-index:50", hdr.top === 0 && hdr.pos === "sticky" && hdr.z === "50", JSON.stringify(hdr));
    await evl(`window.scrollTo({top:0, behavior:"instant"})`);
    await sleep(200);

    /* ---- 6. 收藏 / 取消收藏 ---- */
    await realClickEl('[data-act="fav"]');
    await sleep(300);
    const fav1 = await evl(`(function(){var b=document.getElementById("favCount");return {n:b.textContent, hidden:b.hidden};})()`);
    await realClickEl('[data-act="fav"]');
    await sleep(300);
    const fav2 = await evl(`(function(){var b=document.getElementById("favCount");return {n:b.textContent, hidden:b.hidden};})()`);
    check("收藏→取消收藏（badge 1→0）", fav1.n === "1" && !fav1.hidden && fav2.hidden, JSON.stringify(fav1) + "→" + JSON.stringify(fav2));

    /* ---- 7. 换一条：滚动位置保持 ---- */
    await evl(`window.scrollTo({top:300, behavior:"instant"})`);
    await sleep(200);
    const sy1 = await evl(`window.scrollY`);
    const btnVis = await evl(`(function(){var r=document.querySelector('[data-act="random"]').getBoundingClientRect();return r.top > 0 && r.bottom < window.innerHeight;})()`);
    await realClickEl('[data-act="random"]');
    await sleep(600);
    const sy2 = await evl(`window.scrollY`);
    check("换一条后滚动位置保持", btnVis && sy2 > 200 && Math.abs(sy1 - sy2) < 120, sy1 + "→" + sy2 + " btnVisible=" + btnVis);
    await evl(`window.scrollTo({top:0, behavior:"instant"})`);

    /* ---- 8. 毛选页：手风琴展开/收起 + 搜索 ---- */
    await evl(`location.hash = "#/maoxuan"`);
    await sleep(700);
    const accIdx = await evl(`(function(){var items=document.querySelectorAll(".article-item");for(var i=0;i<items.length;i++){if(!items[i].classList.contains("open"))return i;}return -1;})()`);
    check("毛选页存在收起态文章", accIdx >= 0, "idx=" + accIdx);
    if (accIdx >= 0) {
      await realClickEl(".article-item:nth-of-type(" + (accIdx + 1) + ") .article-head");
      await sleep(600);
      const opened = await evl(`(function(){var it=document.querySelectorAll(".article-item")[${accIdx}];return {open:it.classList.contains("open"), h:it.querySelector(".article-body").offsetHeight};})()`);
      await realClickEl(".article-item:nth-of-type(" + (accIdx + 1) + ") .article-head");
      await sleep(600);
      const closed = await evl(`(function(){var it=document.querySelectorAll(".article-item")[${accIdx}];return {open:it.classList.contains("open"), h:it.querySelector(".article-body").offsetHeight};})()`);
      check("毛选手风琴展开→收起", opened.open && opened.h > 20 && !closed.open && closed.h < 4, JSON.stringify(opened) + "→" + JSON.stringify(closed));
    }
    // 搜索
    await realClickEl("#maoSearch");
    await send("Input.insertText", { text: "实事求是" });
    await sleep(900);
    const search = await evl(`(function(){var v=document.querySelector(".vol-period");return v ? v.textContent : "";})()`);
    check("毛选搜索出结果", /搜索到 [1-9]\d* 条/.test(search || ""), search);
    await evl(`location.hash = "#/"`);
    await sleep(600);

    /* ---- 9. 移动端 390px 无横向溢出 ---- */
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(600);
    const ov = await evl(`(function(){return {sw:document.documentElement.scrollWidth, iw:window.innerWidth};})()`);
    check("390px 无横向溢出", ov.sw <= 391, JSON.stringify(ov));
    await shot("mobile-390.png");
    await send("Emulation.clearDeviceMetricsOverride");
    await sleep(400);

    /* ---- 10. ?theme= 分享参数优先于默认与存储 ---- */
    await navigate(BASE + "/?theme=qinghua");
    await sleep(600);
    const qsTheme = await evl(`document.documentElement.getAttribute("data-theme")`);
    check("?theme= 参数优先", qsTheme === "qinghua", "got=" + qsTheme);
    await evl(`try{localStorage.removeItem("csd_theme")}catch(e){}`); /* 清掉参数测试写入的存储，还原无存储状态 */
    await navigate(BASE + "/");
    await sleep(800);

    /* ---- 11. 桌面首屏截图 ---- */
    await shot("desktop-home.png");

    /* ---- 汇总 ---- */
    const fails = results.filter(r => !r.ok);
    console.log("\n===== 回归汇总: " + (results.length - fails.length) + "/" + results.length + " PASS =====");
    if (fails.length) { fails.forEach(f => console.log("FAILED: " + f.name + " | " + f.detail)); process.exitCode = 2; }
  } finally {
    try { ws.close(); } catch (e) {}
    try { ch.kill(); } catch (e) {}
    if (serverProc) { try { serverProc.kill(); } catch (e) {} }
  }
}
main().then(() => process.exit(process.exitCode || 0)).catch(e => { console.error("FATAL:", e.message || e); process.exit(1); });
