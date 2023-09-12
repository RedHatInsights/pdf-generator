import express from 'express';
import path from 'path';
import cors from 'cors';
import promBundle from 'express-prom-bundle';
import httpContext from 'express-http-context';

import winston from 'winston';
import { LoggerOptionsWithTransports } from 'express-winston';
import expressWinston from 'express-winston';

import config from '../common/config';
import router from './routes/routes';
import identityMiddleware from '../middleware/identity-middleware';

const PORT = config?.webPort;

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.resolve(__dirname, '..', 'build')));
app.use(express.static(path.resolve(__dirname, '../public')));
app.use(
  expressWinston.logger({
    transports: [new winston.transports.Console()],
    requestWhitelist: ['url', 'method', 'httpVersion', 'originalUrl', 'query'],
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.json()
    ),
    meta: false,
    msg: 'HTTP {{req.method}} {{req.url}}',
    expressFormat: true,
    colorize: false,
  } as LoggerOptionsWithTransports)
);
app.use(httpContext.middleware);
app.use(identityMiddleware);
app.use('/', router);

app.listen(PORT, () => console.info('info', `Listening on port ${PORT}`));

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
  console.info(`Metrics server listening on port ${config?.metricsPort}`);
});
