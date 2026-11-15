import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const base = new URL('../dist/', import.meta.url);
const types = { '/': 'text/html', '/index.html': 'text/html', '/styles.css': 'text/css',
  '/app.js': 'text/javascript', '/dates.js': 'text/javascript', '/event.js': 'text/javascript',
  '/offers.json': 'application/json', '/icon.png': 'image/png' };
const port = Number(process.env.PORT || 4173);

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  if (!Object.hasOwn(types, pathname)) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(new URL(pathname === '/' ? 'index.html' : pathname.slice(1), base));
    response.writeHead(200, { 'Content-Type': types[pathname], 'Cache-Control': 'no-store' }).end(body);
  } catch {
    response.writeHead(500).end('Local asset unavailable');
  }
}).listen(port, '127.0.0.1', () => console.log(`Offer Finder on http://127.0.0.1:${port}`));

