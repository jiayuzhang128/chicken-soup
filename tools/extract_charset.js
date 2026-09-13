/* 提取站点运行时可能渲染的全部字符 → charset.txt（供 pyftsubset 用）
   来源：4 个数据文件 + app.js + index.html + style.css（含伪元素 content 文案）。
   原则：所有运行时字符串要么来自这些文件的字面量/数据，要么是 ASCII 日期数字——
   因此「全部出现过的字符 + 全量 ASCII 可打印 + 常用中文标点」即 100% 覆盖。 */
const fs = require("fs");
const path = require("path");
const ROOT = "J:\\win10data\\AI\\ChickenSoup";
const files = [
  "data/maoxuan.js", "data/sanshiliuji.js", "data/tiandao.js", "data/juexing.js",
  "assets/js/app.js", "index.html", "assets/css/style.css"
];
const chars = new Set();
for (const f of files) {
  const text = fs.readFileSync(path.join(ROOT, f), "utf8");
  for (const ch of text) chars.add(ch);
}
// 防御性补充：全量 ASCII 可打印 + 常用中文标点/符号 + 全角形式
let extra = "";
for (let c = 0x20; c <= 0x7e; c++) extra += String.fromCodePoint(c);
extra += "，。、；：？！…—～·「」『』（）《》〈〉【】〔〕＂＇＃＄％＆＊＋－／＝＼｜～＾＠";
extra += "０１２３４５６７８９ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ";
extra += "\u2018\u2019\u201c\u201d\u2026\u00b7\u00d7\u00f7\u2190\u2191\u2192\u2193\u25cf\u25cb\u25b2\u25bc\u2714\u2718\u2665\u3000";
for (const ch of extra) chars.add(ch);
chars.delete("\n"); chars.delete("\r");
const out = [...chars].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join("");
const cjk = [...chars].filter(c => c.codePointAt(0) >= 0x3400 && c.codePointAt(0) <= 0x9fff).length;
fs.writeFileSync(process.env.TEMP + "\\csd_diag\\charset.txt", out, "utf8");
console.log("总字符数:", chars.size, "| 其中 CJK:", cjk, "| 输出:", process.env.TEMP + "\\csd_diag\\charset.txt");
