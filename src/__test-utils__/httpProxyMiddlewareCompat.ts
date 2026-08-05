import httpProxy from 'http-proxy';
import type { ClientRequest } from 'http';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

interface ProxyMiddlewareOptions {
  target: string;
  changeOrigin?: boolean;
  secure?: boolean;
  pathFilter?: (path: string) => boolean;
  pathRewrite?: (path: string) => string;
  logger?: {
    debug?: (...args: unknown[]) => void;
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
  on?: {
    proxyReq?: (proxyReq: ClientRequest, req: Request, res: Response) => void;
  };
}

/**
 * Minimal http-proxy-middleware v4-compatible shim for Jest integration tests.
 * Jest cannot import the ESM-only v4 package without transformIgnorePatterns changes.
 */
export function createProxyMiddleware(
  options: ProxyMiddlewareOptions,
): RequestHandler {
  const proxy = httpProxy.createProxyServer({
    target: options.target,
    changeOrigin: options.changeOrigin ?? false,
    secure: options.secure ?? true,
    xfwd: true,
  });

  if (options.on?.proxyReq) {
    const proxyReqHandler = options.on.proxyReq;
    proxy.on('proxyReq', (proxyReq, req, res) => {
      proxyReqHandler(proxyReq, req as Request, res as Response);
    });
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const path = req.url ?? '/';
    if (options.pathFilter && !options.pathFilter(path)) {
      next();
      return;
    }

    const rewrittenPath = options.pathRewrite
      ? options.pathRewrite(path)
      : path;

    req.url = rewrittenPath;
    proxy.web(req, res, { target: options.target }, (error) => {
      if (error) {
        options.logger?.error?.(error);
        next(error);
      }
    });
  };
}
