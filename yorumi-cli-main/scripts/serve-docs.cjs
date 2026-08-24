const http = require('node:http');
const { readFileSync, existsSync } = require('node:fs');
const { extname, join, normalize } = require('node:path');

const root = join(__dirname, '..', 'docs');
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0] || '/');
  const safePath = urlPath === '/'
    ? 'index.html'
    : normalize(urlPath).replace(/^[/\\]+/, '').replace(/^(\.\.[/\\])+/, '');
  const filePath = join(root, safePath);
  const target = existsSync(filePath) ? filePath : join(root, 'index.html');
  const type = types[extname(target)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  res.end(readFileSync(target));
}).listen(port, '127.0.0.1', () => {
  console.log(`Yorumi CLI docs: http://localhost:${port}`);
});
