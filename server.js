// Minimaler statischer Dev-Server, zero dependencies.
// Startet auf Port 3001 und liefert public/ und src/ aus.
// Boris startet diesen Server selbst in einer eigenen Shell:  node server.js  (oder: npm start)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = 3001;

// ES-Module brauchen den korrekten MIME-Type, sonst weigert sich der Browser zu laden.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    // index.html liegt in public/, alles andere wird relativ zum Projektwurzelverzeichnis aufgelöst.
    let filePath;
    if (urlPath === '/index.html') {
      filePath = join(ROOT, 'public', 'index.html');
    } else if (urlPath.startsWith('/public/') || urlPath.startsWith('/src/')) {
      filePath = join(ROOT, urlPath);
    } else {
      // Fallback: erst public/, dann Wurzel
      filePath = join(ROOT, 'public', urlPath);
    }

    // Directory-Traversal verhindern (join() normalisiert bereits; der
    // Separator-Anhang verhindert, dass Geschwister wie "spacemaze-foo"
    // durch den Prefix-Vergleich rutschen).
    if (!filePath.startsWith(ROOT + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const data = await readFile(filePath);
    const type = MIME[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 Not Found: ' + req.url);
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end('500 Server Error');
      console.error(err);
    }
  }
});

server.listen(PORT, () => {
  console.log(`SPACE MAZE dev server läuft:  http://localhost:${PORT}/`);
  console.log(`Debug-Modus:                  http://localhost:${PORT}/?debug`);
});
