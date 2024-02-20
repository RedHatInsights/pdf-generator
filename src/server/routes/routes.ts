import fs from 'fs';
import { Router } from 'express';
import httpContext from 'express-http-context';
import getTemplateData from '../data-access';
import ServiceNames from '../../common/service-names';
import renderTemplate from '../render-template';
import PdfCache, {
  processOrientationOption,
  sanitizeInput,
} from '../../browser/helpers';
import { SendingFailedError, PDFNotFoundError } from '../errors';
import config from '../../common/config';
import previewPdf from '../../browser/previewPDF';
import pool from '../workers';
import { Request } from 'express';
import {
  GenerateHandlerRequest,
  PdfRequestBody,
  PuppeteerBrowserRequest,
  PreviewHandlerRequest,
} from '../../common/types';
import { apiLogger } from '../../common/logging';
import { v4 as uuidv4 } from 'uuid';
import { ReportCache } from '../cache';
import { downloadPDF } from '../../common/objectStore';

const router = Router();
const cache = new ReportCache();
const pdfCache = PdfCache.getInstance();

function getPdfRequestBody(req: GenerateHandlerRequest): PdfRequestBody {
  const rhIdentity = httpContext.get(config?.IDENTITY_HEADER_KEY);
  const orientationOption = processOrientationOption(req);
  const service = req.body.service;
  const template = req.body.template;
  const dataOptions = req.body;
  const uuid = `${uuidv4()}`;
  const url = `http://localhost:${config?.webPort}?template=${template}&service=${service}`;
  return {
    url,
    rhIdentity,
    templateConfig: {
      service,
      template,
    },
    orientationOption,
    dataOptions,
    uuid,
  };
}

const isValidPdfRequest = (body: PdfRequestBody) => {
  // identity is handled at the worker level
  if (
    body.templateConfig.template === '' ||
    !Object.values(ServiceNames).includes(body.templateConfig.service)
  ) {
    return false;
  }
  return true;
};

// Middleware that activates on all routes, responsible for rendering the correct
// template/component into html to the requester.
router.use('^/$', async (req: PuppeteerBrowserRequest, res, _next) => {
  let service: ServiceNames = req.query.service;
  let template: string = req.query.template;
  if (!service) {
    apiLogger.warning('Missing service, using "demo"');
    service = ServiceNames.demo;
  }
  if (!template) {
    apiLogger.warning('Missing template, using "demo"');
    template = 'demo';
  }

  const templateConfig = {
    service,
    template,
  };
  try {
    const configHeaders: string | string[] | undefined =
      req.headers[config?.OPTIONS_HEADER_NAME];
    if (configHeaders) {
      delete req.headers[config?.OPTIONS_HEADER_NAME];
    }

    const templateData = await getTemplateData(
      req.headers,
      templateConfig,
      configHeaders ? JSON.parse(configHeaders as string) : undefined
    );

    const HTMLTemplate: string = renderTemplate(
      templateConfig,
      templateData as Record<string, unknown>
    );
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
  async (req: GenerateHandlerRequest, res, next) => {
    const pdfDetails = getPdfRequestBody(req);
    const pdfID = pdfDetails.uuid;
    if (!isValidPdfRequest(pdfDetails)) {
      const errStr = 'Failed: service and template options must not be empty';
      apiLogger.debug(errStr);
      pdfCache.setItem(pdfID, { status: errStr, filepath: '' });
      return res.status(400).send({
        error: {
          status: 400,
          statusText: 'Bad Request',
          description: `${errStr}`,
        },
      });
    }
    pdfDetails.uuid = pdfID;
    apiLogger.debug(pool.stats());
    // TODO: Send to some object store (Redis?)
    pdfCache.setItem(pdfID, { status: 'Received', filepath: '' });

    try {
      pool
        .exec<(...args: unknown[]) => string>('generatePdf', [pdfDetails])
        .catch((error: unknown) => {
          apiLogger.error(`${error}`);
        });
      pdfCache.setItem(pdfID, { status: 'Generating', filepath: '' });

      return res.status(202).send({ statusID: pdfID });
    } catch (error: unknown) {
      const errStr = `${error}`;
      if (errStr.includes('No API descriptor')) {
        apiLogger.error(`Error: ${error}`);
        pdfCache.setItem(pdfID, { status: `Failed: ${errStr}`, filepath: '' });
        res.status(400).send({
          error: {
            status: 400,
            statusText: 'Bad Request',
            description: `${error}`,
          },
        });
      } else {
        apiLogger.error(`Internal Server error: ${error}`);
        pdfCache.setItem(pdfID, { status: `Failed: ${error}`, filepath: '' });
        res.status(500).send({
          error: {
            status: 500,
            statusText: 'Internal server error',
            description: `${error}`,
          },
        });
      }
      next();
    } finally {
      // To handle the edge case where a pool terminates while the queue isn't empty,
      // we ensure that the queue is empty and all workers are idle.
      const stats = pool.stats();
      apiLogger.debug(JSON.stringify(stats, null, 2));
      if (
        stats.pendingTasks === 0 &&
        stats.totalWorkers === stats.idleWorkers
      ) {
        await pool.terminate();
      }
    }
  }
);

router.get(`${config?.APIPrefix}/v2/status/:statusID`, (req: Request, res) => {
  const ID = req.params.statusID;
  try {
    const status = pdfCache.getItem(ID);
    apiLogger.debug(JSON.stringify(status));
    if (!status) {
      res.status(404).send({
        error: {
          status: 404,
          statusText: 'PDF status could not be determined; Please check the ID',
          description: `No PDF status found for ${ID}`,
        },
      });
    }

    return res.status(200).send({ status });
  } catch (error) {
    res.status(400).send({
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
      const stream = await downloadPDF(ID);
      if (!stream) {
        return res.status(404).send({
          error: {
            status: 404,
            statusText: `No PDF found; Please check the status of this ID`,
            description: `No PDF found for ${ID}`,
          },
        });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${ID}.pdf"`);
      stream.pipe(res);
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
  async (req: GenerateHandlerRequest, res, next) => {
    const pdfDetails = getPdfRequestBody(req);
    const { rhIdentity: _, ...noIdentityHeader } = pdfDetails;
    const accountID = httpContext.get(config?.ACCOUNT_ID);
    const cacheKey = cache.createCacheKey({
      request: noIdentityHeader,
      accountID: accountID,
    });
    apiLogger.debug(`Hashed key ${cacheKey} with Account ID ${accountID}`);

    // Check for a cached version of the pdf
    const filePath = cache.fetch(sanitizeInput(cacheKey));
    if (filePath) {
      apiLogger.info(`No new generation needed ${filePath} found in cache.`);
      return res.status(200).sendFile(sanitizeInput(filePath), (err) => {
        if (err) {
          const errorMessage = new SendingFailedError(filePath, err);
          res.status(500).send({
            error: {
              status: 500,
              statusText: 'PDF was generated, but could not be sent',
              description: `${errorMessage}`,
            },
          });
        }
      });
    }

    apiLogger.debug(JSON.stringify(pool.stats(), null, 2));

    try {
      const pathToPdf = await pool.exec<(...args: unknown[]) => string>(
        'generatePdf',
        [pdfDetails]
      );

      const pdfFileName = pathToPdf.split('/').pop();

      if (!fs.existsSync(pathToPdf)) {
        throw new PDFNotFoundError(pdfFileName as string);
      }
      cache.fill(cacheKey, pathToPdf);
      return res.status(200).sendFile(sanitizeInput(pathToPdf), (err) => {
        if (err) {
          const errorMessage = new SendingFailedError(
            pdfFileName as string,
            err
          );
          res.status(500).send({
            error: {
              status: 500,
              statusText: 'PDF was generated, but could not be sent',
              description: `${errorMessage}`,
            },
          });
        }
        apiLogger.info('Successfully generated report');
      });
    } catch (error: unknown) {
      const errStr = `${error}`;
      if (errStr.includes('No API descriptor')) {
        apiLogger.error(`Failed to generate a PDF: ${error}`);
        res.status(400).send({
          error: {
            status: 400,
            statusText: 'Bad Request',
            description: `${error}`,
          },
        });
      } else {
        apiLogger.error(`Internal Server error: ${error}`);
        res.status(500).send({
          error: {
            status: 500,
            statusText: 'Internal server error',
            description: `${error}`,
          },
        });
      }
      next();
    } finally {
      // To handle the edge case where a pool terminates while the queue isn't empty,
      // we ensure that the queue is empty and all workers are idle.
      const stats = pool.stats();
      apiLogger.debug(JSON.stringify(stats, null, 2));
      if (
        stats.pendingTasks === 0 &&
        stats.totalWorkers === stats.idleWorkers
      ) {
        await pool.terminate();
      }
    }
  }
);

router.get(`/preview`, async (req: PreviewHandlerRequest, res) => {
  const service: ServiceNames = req.query.service;
  const template: string = req.query.template;
  let templateData: unknown;
  try {
    templateData = await getTemplateData(req.headers, {
      service,
      template,
    });
  } catch (error) {
    return res.status(500).send({
      errors: [
        {
          status: 500,
          statusText: 'Internal server error',
          detail: error,
        },
      ],
    });
  }
  const orientationOption = processOrientationOption(req);

  const url = `http://localhost:${config?.webPort}?service=${service}&template=${template}`;

  try {
    const pdfBuffer = await previewPdf(
      url,
      {
        service,
        template,
      },
      templateData as Record<string, unknown>,
      orientationOption // could later turn into a full options object for other things outside orientation.
    );
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
        .send(`An error occurred while fetching the OpenAPI spec : ${err}`);
    } else {
      return res.json(JSON.parse(data));
    }
  });
});

export default router;
