import http from 'http';
import fs from 'fs';
import path from 'path';

const FIXTURE_DIR = path.resolve(__dirname);

// 1x1 transparent PNG
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
    'Nl7BcQAAAABJRU5ErkJggg==',
  'base64',
);

function serveFile(
  res: http.ServerResponse,
  filename: string,
  contentType: string,
) {
  const content = fs.readFileSync(path.join(FIXTURE_DIR, filename), 'utf-8');
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
}

function json(res: http.ServerResponse, data: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const ROUTES: Record<string, (res: http.ServerResponse) => void> = {
  '/': (res) => serveFile(res, 'index.html', 'text/html'),
  '/error': (res) => serveFile(res, 'error.html', 'text/html'),
  '/template-error': (res) =>
    serveFile(res, 'template-error.html', 'text/html'),
  '/hang': (res) => serveFile(res, 'hang.html', 'text/html'),
  '/api/batch/1': (res) => json(res, { items: ['item1', 'item2'] }),
  '/api/batch/2': (res) => json(res, { items: ['batch2-data'] }),
  '/fixtures/test.png': (res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(PIXEL_PNG);
  },
};

export function startFixtureServer(): Promise<{
  server: http.Server;
  baseUrl: string;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const handler = ROUTES[req.url ?? ''];
      if (handler) {
        handler(res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}
