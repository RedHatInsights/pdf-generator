/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import fs from 'fs';
import crypto from 'crypto';
import PdfCache from '../../common/pdfCache';
import { PdfGenerationError } from '../errors';
import { Router, Request } from 'express';
import httpContext from 'express-http-context';
import renderTemplate from '../render-template';
import config from '../../common/config';
import previewPdf from '../../browser/previewPDF';
import {
  GenerateHandlerRequest,
  PdfRequestBody,
  PuppeteerBrowserRequest,
  PreviewHandlerRequest,
  GeneratePayload,
} from '../../common/types';
import { apiLogger } from '../../common/logging';
import { downloadPDF } from '../../common/objectStore';
import { UpdateStatus } from '../utils';
import { cluster } from '../cluster';
import { generatePdf } from '../../browser/clusterTask';
import { createProxyMiddleware } from 'http-proxy-middleware';

const router = Router();
const pdfCache = PdfCache.getInstance();

let hasProxy = false;

function addProxy(req: GenerateHandlerRequest) {
  if (!hasProxy) {
    if (config.scalprum.apiHost === 'blank') {
      const apiHost = 'https' + '://' + req.get('host');
      config.scalprum.apiHost = apiHost;
      apiLogger.debug(
        `The variable apiHost is not in config! Falling back to request origin host: ${apiHost}`
      );
    }
    if (config.scalprum.assetsHost === 'blank') {
      const assetsHost = 'https' + '://' + req.get('host');
      config.scalprum.assetsHost = assetsHost;
      apiLogger.debug(
        `The variable assetsHost is not in config! Falling back to request origin host: ${assetsHost}`
      );
    }
    const assetsProxy = createProxyMiddleware({
      target: config.scalprum.assetsHost,
      changeOrigin: true,
      pathFilter: (path) => path.startsWith('/apps'),
      preserveHeaderKeyCase: true,
      secure: false,
      autoRewrite: true,
      headers: {
        origin: config.scalprum.assetsHost,
      },
      on: {
        proxyReq: (proxyReq, req) => {
          req.headers['host'] = config.scalprum.assetsHost;
          proxyReq.setHeader('origin', config.scalprum.assetsHost);
          const identityHeader = proxyReq.getHeader(config.IDENTITY_HEADER_KEY);
          apiLogger.debug(`Identity header: ${identityHeader}`);
          const authHeader = proxyReq.getHeader(
            config.AUTHORIZATION_CONTEXT_KEY
          );
          apiLogger.debug(`Auth header: ${authHeader}`);
          if (authHeader) {
            proxyReq.setHeader(config.AUTHORIZATION_HEADER_KEY, authHeader);
          }
          req.headers['referer'] = config.scalprum.assetsHost;
          proxyReq.setHeader('referer', config.scalprum.assetsHost);
          proxyReq.setHeader(
            'x-forwarded-host',
            config.scalprum.assetsHost.replace('https://', '')
          );
          // set AUTH header for gateway
          proxyReq.removeHeader(config.AUTHORIZATION_CONTEXT_KEY);
          console.log(proxyReq.getHeaders());
        },
      },
      logger: apiLogger,
    });
    const apiProxy = createProxyMiddleware({
      target: config.scalprum.apiHost,
      changeOrigin: true,
      secure: false,
      autoRewrite: true,
      headers: {
        origin: config.scalprum.assetsHost,
      },
      pathFilter: (path) =>
        path.startsWith('/api') && !path.includes('crc-pdf-generator'),
      preserveHeaderKeyCase: true,
      on: {
        proxyReq: (proxyReq) => {
          req.headers['host'] = config.scalprum.apiHost;
          proxyReq.setHeader('origin', config.scalprum.apiHost);
          const authHeader = proxyReq.getHeader(
            config.AUTHORIZATION_CONTEXT_KEY
          );
          if (authHeader) {
            proxyReq.setHeader(config.AUTHORIZATION_HEADER_KEY, authHeader);
          }
          req.headers['referer'] = config.scalprum.apiHost;
          proxyReq.setHeader('referer', config.scalprum.apiHost);
          proxyReq.setHeader(
            'x-forwarded-host',
            config.scalprum.apiHost.replace('https://', '')
          );

          proxyReq.removeHeader(config.AUTHORIZATION_CONTEXT_KEY);
        },
      },
      logger: apiLogger,
    });
    router.use(assetsProxy);
    router.use(apiProxy);
    hasProxy = true;
  }
}

function getPdfRequestBody(payload: GeneratePayload): PdfRequestBody {
  const { manifestLocation, module, scope, fetchDataParams, importName } =
    payload;
  const uuid = crypto.randomUUID();
  const requestURL = new URL(`http://localhost:${config?.webPort}/puppeteer`);
  requestURL.searchParams.append('manifestLocation', manifestLocation);
  requestURL.searchParams.append('scope', scope);
  requestURL.searchParams.append('module', module);
  if (importName) {
    requestURL.searchParams.append('importName', importName);
  }
  if (fetchDataParams) {
    requestURL.searchParams.append(
      'fetchDataParams',
      JSON.stringify(fetchDataParams)
    );
  }
  return {
    ...payload,
    authHeader: httpContext.get(config.AUTHORIZATION_CONTEXT_KEY) as string,
    identity: httpContext.get(config?.IDENTITY_HEADER_KEY) as string,
    uuid,
    url: requestURL.toString(),
  };
}

// Middleware that activates on all routes, responsible for rendering the correct
// template/component into html to the requester.
router.get('/puppeteer', (req: PuppeteerBrowserRequest, res, _next) => {
  addProxy(req as any);
  const payload = req.query;
  if (!payload) {
    apiLogger.warning('Missing template, using "demo"');
    throw new Error('Missing template metadata!');
  }
  try {
    const configHeaders: string | string[] | undefined =
      req.headers[config?.OPTIONS_HEADER_NAME];
    if (configHeaders) {
      delete req.headers[config?.OPTIONS_HEADER_NAME];
    }

    const HTMLTemplate: string = renderTemplate(payload);
    res.send(HTMLTemplate);
  } catch (error) {
    // render error to DOM to retrieve the error content from puppeteer
    res.send(
      `<div id="report-error" data-error="${JSON.stringify(
        error
      )}">${error}</div>`
    );
  }
});

router.get(`${config?.APIPrefix}/v1/hello`, (_req, res) => {
  return res.status(200).send('<h1>Well this works!</h1>');
});

router.post(
  `${config?.APIPrefix}/v2/create`,
  async (req: GenerateHandlerRequest, res) => {
    addProxy(req);
    const collectionId = crypto.randomUUID();
    // for testing purposes
    console.log(req.body.payload);
    const requestConfigs = Array.isArray(req.body.payload)
      ? req.body.payload
      : [req.body.payload];

    try {
      const requiredCalls = requestConfigs.length;
      if (requiredCalls === 1) {
        // need to support multiple IDs in a group
        // and await the results to combine
        const pdfDetails = getPdfRequestBody(requestConfigs[0]);
        const configHeaders: string | string[] | undefined =
          req.headers[config?.OPTIONS_HEADER_NAME];
        if (configHeaders) {
          delete req.headers[config?.OPTIONS_HEADER_NAME];
        }
        apiLogger.debug(`Single call to generator queued for ${collectionId}`);
        await generatePdf(pdfDetails, collectionId);
        const updateMessage = {
          status: 'Generating',
          filepath: '',
          componentId: pdfDetails.uuid,
          collectionId,
        };
        UpdateStatus(updateMessage);
        return res.status(202).send({ statusID: collectionId });
      }
      // add these in a loop
      // LOOP based on payload length
      for (let x = 0; x < Number(requiredCalls); x++) {
        const pdfDetails = getPdfRequestBody(requestConfigs[x]);
        const configHeaders: string | string[] | undefined =
          req.headers[config?.OPTIONS_HEADER_NAME];
        if (configHeaders) {
          delete req.headers[config?.OPTIONS_HEADER_NAME];
        }
        apiLogger.debug(`Queueing ${requiredCalls} for ${collectionId}`);
        await generatePdf(pdfDetails, collectionId);
        const updateMessage = {
          status: 'Generating',
          filepath: '',
          componentId: pdfDetails.uuid,
          collectionId: collectionId,
        };
        UpdateStatus(updateMessage);
      }

      return res.status(202).send({ statusID: collectionId });
    } catch (error: unknown) {
      if (error instanceof PdfGenerationError) {
        if (error.message.includes('No API descriptor')) {
          const updateMessage = {
            status: `Failed: ${error.message}`,
            filepath: '',
            collectionId: error.collectionId,
            componentId: error.componentId,
          };
          apiLogger.error(`Error: ${JSON.stringify(error)}`);
          UpdateStatus(updateMessage);
          res.status(400).send({
            error: {
              status: 400,
              statusText: 'Bad Request',
              description: `${JSON.stringify(error)}`,
            },
          });
        } else {
          apiLogger.error(`Internal Server error: ${JSON.stringify(error)}`);
          const updateMessage = {
            status: `Failed: ${JSON.stringify(error)}`,
            filepath: '',
            collectionId: error.collectionId,
            componentId: error.componentId,
          };
          UpdateStatus(updateMessage);
          res.status(500).send({
            error: {
              status: 500,
              statusText: 'Internal server error',
              description: `${JSON.stringify(error)}`,
            },
          });
        }
      }
    } finally {
      // To handle the edge case where a pool terminates while the queue isn't empty,
      // we ensure that the queue is empty .
      await cluster.idle();
      apiLogger.debug('task finished');
      await cluster.close();
    }
  }
);

router.get(`${config?.APIPrefix}/v2/status/:statusID`, (req: Request, res) => {
  const ID = req.params.statusID;
  try {
    const status = pdfCache.getCollection(ID);
    apiLogger.debug(JSON.stringify(status));
    if (!status) {
      return res.status(404).send({
        error: {
          status: 404,
          statusText: 'PDF status could not be determined; Please check the ID',
          description: `No PDF status found for ${ID}`,
        },
      });
    }

    return res.status(200).send({ status });
  } catch (error) {
    return res.status(400).send({
      error: {
        status: 400,
        statusText: 'PDF status could not be determined',
        description: `Error: ${error}`,
      },
    });
  }
});

router.get(
  `${config?.APIPrefix}/v2/download/:ID`,
  async (req: Request, res) => {
    const ID = req.params.ID;
    try {
      apiLogger.debug(ID);
      const response = await downloadPDF(ID);
      if (!response) {
        return res.status(404).send({
          error: {
            status: 404,
            statusText: `No PDF found; Please check the status of this ID`,
            description: `No PDF found for ${ID}`,
          },
        });
      }
      if (response.byteLength && response.byteLength > 0) {
        res.setHeader('Content-Length', response.byteLength);
      }
      res.setHeader('Content-Disposition', `inline; filename="${ID}.pdf"`);
      res.setHeader('Content-Type', 'application/pdf');
      res.send(response);
    } catch (error) {
      res.status(400).send({
        error: {
          status: 400,
          statusText: 'PDF status could not be determined',
          description: `Error: ${error}`,
        },
      });
    }
  }
);

router.post(
  `${config?.APIPrefix}/v1/generate`,
  async (_req: GenerateHandlerRequest, res) => {
    res.status(400).send('This endpoint is deprecated. Please use /v2/create');
  }
);

router.get(`/preview`, async (req: PreviewHandlerRequest, res) => {
  addProxy(req as any);
  const pdfUrl = new URL(`http://localhost:${config?.webPort}/puppeteer`);
  pdfUrl.searchParams.append('manifestLocation', req.query.manifestLocation);
  pdfUrl.searchParams.append('scope', req.query.scope);
  pdfUrl.searchParams.append('module', req.query.module);
  pdfUrl.searchParams.append(
    'identity',
    httpContext.get(config?.IDENTITY_HEADER_KEY) as string
  );
  if (req.query.importName) {
    pdfUrl.searchParams.append('importName', req.query.importName);
  }
  if (req.query.fetchDataParams) {
    pdfUrl.searchParams.append(
      'fetchDataParams',
      JSON.stringify(req.query.fetchDataParams)
    );
  }

  try {
    const pdfBuffer = await previewPdf(pdfUrl.toString());
    res.set('Content-Type', 'application/pdf');
    res.status(200).send(pdfBuffer);
  } catch (error: unknown) {
    if (error instanceof Error) {
      // error.code is not part of the Error definition for TS inside of Node. Choices: delete the usage of code, or, force a new definition.
      apiLogger.error(`${error.message}`);
      // res.status((error.code as number) || 500).send(error.message);
      res.status(500).send(error.message); // only here as example, we don't want to force a 500 every time.
    }
  }
});

router.get('/healthz', (_req, res, _next) => {
  return res.status(200).send('Build assets available');
});

router.get(`${config?.APIPrefix}/v1/openapi.json`, (_req, res, _next) => {
  fs.readFile('./docs/openapi.json', 'utf8', (err, data) => {
    if (err) {
      apiLogger.error(err);
      return res
        .status(500)
        .send(
          `An error occurred while fetching the OpenAPI spec : ${err.message}`
        );
    } else {
      return res.json(JSON.parse(data));
    }
  });
});

export default router;
