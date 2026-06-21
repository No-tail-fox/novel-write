import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = normalize(import.meta.dirname);
const port = Number(process.env.PORT ?? 4175);
const host = '127.0.0.1';
const types = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'text/javascript;charset=utf-8',
  '.mjs': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const filePath = normalize(join(root, decoded === '/' ? 'index.html' : decoded));
  return filePath.startsWith(root) ? filePath : null;
}

createServer(async (req, res) => {
  try {
    let filePath = safePath(req.url ?? '/');
    if (!filePath) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    if (info.isDirectory()) filePath = join(filePath, 'index.html');

    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': types[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
    res.end(data);
  } catch (error) {
    res.writeHead(500);
    res.end(error instanceof Error ? error.message : 'Server error');
  }
}).listen(port, host, () => {
  console.log(`OPC course hub at http://${host}:${port}/`);
});
