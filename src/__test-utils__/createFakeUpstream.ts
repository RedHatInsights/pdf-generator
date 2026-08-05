import http from 'http';
import type { IncomingHttpHeaders } from 'http';
import type { AddressInfo } from 'net';

export interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export function createFakeUpstream() {
  let server: http.Server | undefined;
  const captured: CapturedRequest[] = [];
  let responseStatus = 200;
  let responseBody = 'ok';

  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      captured.push({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      });
      res.writeHead(responseStatus, { 'Content-Type': 'text/plain' });
      res.end(responseBody);
    });
  };

  return {
    captured,
    lastRequest: (): CapturedRequest | undefined =>
      captured.length > 0 ? captured[captured.length - 1] : undefined,
    setResponse: (status: number, body: string) => {
      responseStatus = status;
      responseBody = body;
    },
    start: (): Promise<number> =>
      new Promise((resolve, reject) => {
        server = http.createServer(handler);
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const address = server?.address() as AddressInfo;
          resolve(address.port);
        });
      }),
    stop: (): Promise<void> =>
      new Promise((resolve, reject) => {
        if (!server) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
