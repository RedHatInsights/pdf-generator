import express, { type Express, type RequestHandler } from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import cookieParser from 'cookie-parser';
import httpContext from 'express-http-context';
import identityMiddleware from '../middleware/identity-middleware';

export interface TestResponse {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

export function createTestApp(
  ...additionalMiddleware: RequestHandler[]
): Express {
  const app = express();
  app.use(cookieParser());
  app.use(httpContext.middleware);
  app.use(identityMiddleware);
  additionalMiddleware.forEach((middleware) => app.use(middleware));
  app.use((_req, res) => {
    res.status(404).send('Not Found');
  });
  return app;
}

export async function sendTestRequest(
  app: Express,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<TestResponse> {
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = (server.address() as AddressInfo).port;

  try {
    return await new Promise<TestResponse>((resolve, reject) => {
      const request = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString(),
              headers: response.headers,
            });
          });
        },
      );
      request.on('error', reject);
      request.end();
    });
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}
