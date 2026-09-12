// Usage: node gbk2utf8.js <infile> <outfile>
const fs = require('fs');
const [,, infile, outfile] = process.argv;
const buf = fs.readFileSync(infile);
let text;
try {
  text = new TextDecoder('gbk').decode(buf);
} catch (e) {
  console.error('GBK decode failed:', e.message);
  process.exit(1);
}
fs.writeFileSync(outfile, text, 'utf8');
console.log('OK', infile, '->', outfile, text.length, 'chars');
