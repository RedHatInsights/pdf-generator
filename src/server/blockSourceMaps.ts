import type { RequestHandler } from 'express';

/**
 * Prevents HTTP access to webpack source map files under static mounts.
 * Server-side .map files stay on disk for source-map-support but must not be served.
 */
export const blockSourceMaps: RequestHandler = (req, res, next) => {
  if (req.path.endsWith('.map')) {
    res.sendStatus(404);
    return;
  }
  next();
};
