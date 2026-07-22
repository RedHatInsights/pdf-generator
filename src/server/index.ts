import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import promBundle from 'express-prom-bundle';
import httpContext from 'express-http-context';
import http from 'http';
import config from '../common/config';
import router from './routes/routes';
import identityMiddleware from '../middleware/identity-middleware';
import { requestLogger, apiLogger } from '../common/logging';
import {
  logStartup,
  logShutdown,
  logSecurityEvent,
} from '../common/securityLog';
import PdfCache from '../common/pdfCache';
import { store, StoreType } from '../common/store/store';
import { consumeMessages } from '../common/kafka';
import { UPDATE_TOPIC } from '../browser/constants';

const PORT = config?.webPort;

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.resolve(__dirname, '..', 'build')));
app.use(express.static(path.resolve(__dirname, '../public')));
app.use(cookieParser());
app.use(httpContext.middleware);
app.use(`${config?.APIPrefix}/v2/create`, identityMiddleware);
app.use('/preview', identityMiddleware);
app.use(requestLogger);
router.use('/public', express.static(path.resolve(__dirname, './public')));
app.use('/', router);

PdfCache.getInstance();
store.intialize(StoreType.S3);

const server = http.createServer({}, app);

// Increase max listeners to accommodate multiple middleware/handlers
// (express-prom-bundle, http-context, static handlers, error handlers)
// Default is 10, saw 11 in production logs
server.setMaxListeners(20);

server.listen(PORT, () => {
  apiLogger.info(`Listening on port ${PORT}`);
  logStartup(PORT);
  consumeMessages(UPDATE_TOPIC).catch((error: unknown) => {
    apiLogger.error(`${error}`);
  });
});

// Graceful shutdown logging (EOI-5)
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    logShutdown(signal);
    const { disconnectProducer } = await import('../common/kafka');
    await disconnectProducer().catch(() => {});
  });
}

// setup keep alive timeout
server.keepAliveTimeout = 60 * 1000 + 1000; // 61 s
server.keepAliveTimeout = 60 * 1000 + 2000; // 62 s

// Global error handlers to prevent crashes from unhandled rejections
process.on(
  'unhandledRejection',
  (reason: unknown, promise: Promise<unknown>) => {
    apiLogger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    logSecurityEvent(
      {
        action: 'ERROR',
        resource_type: 'process',
        resource_id: 'crc-pdf-generator',
        outcome: 'failure',
        principal: { type: 'system' },
      },
      `Unhandled rejection: ${reason}`,
    );
    // Don't exit in production - log and continue
    // This prevents process crashes from async errors in PDF generation
  },
);

process.on('uncaughtException', (error: Error) => {
  apiLogger.error('Uncaught Exception:', error);
  logSecurityEvent(
    {
      action: 'ERROR',
      resource_type: 'process',
      resource_id: 'crc-pdf-generator',
      outcome: 'failure',
      principal: { type: 'system' },
    },
    `Uncaught exception: ${error.message}`,
  );
  // Log the error but don't exit - let container orchestration handle restarts
});

// HTTP server error handler
server.on('error', (error: Error) => {
  apiLogger.error('HTTP Server error:', error);
});

const metricsApp = express();

const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true,
  includeStatusCode: true,
  includeUp: true,
  metricsPath: config?.metricsPath,
  promClient: {
    collectDefaultMetrics: {},
  },
});

metricsApp.use(metricsMiddleware);
metricsApp.listen(config?.metricsPort, () => {
  apiLogger.info(`Metrics server listening on port ${config?.metricsPort}`);
});
