// Convert all downloaded GB2312 html files to UTF-8 plain text
const fs = require('fs');
const path = require('path');
const dir = __dirname;

function decodeGB(buf) {
  try { return new TextDecoder('gbk').decode(buf); }
  catch (e) { return buf.toString('utf8'); }
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.htm'));
let ok = 0, fail = [];
for (const f of files) {
  try {
    let html = decodeGB(fs.readFileSync(path.join(dir, f)));
    // extract body after <hr> (skip nav/header)
    let text = html;
    text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    // block-ish tags to newline
    text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li)>/gi, '\n');
    // drop remaining tags
    text = text.replace(/<[^>]+>/g, '');
    // entities
    text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d));
    // normalize whitespace lines
    text = text.split('\n').map(l => l.replace(/[\t ]+/g, ' ').trim()).filter(l => l.length > 0).join('\n');
    fs.writeFileSync(path.join(dir, f.replace(/\.htm$/, '.txt')), text, 'utf8');
    ok++;
  } catch (e) {
    fail.push(f + ': ' + e.message);
  }
}
console.log('converted', ok, 'files; failures:', fail.length ? fail.join(' | ') : 'none');
