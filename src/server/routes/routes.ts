import fs from 'fs';
import { Router, Request } from 'express';
import httpContext from 'express-http-context';
import getTemplateData from '../data-access';
import ServiceNames from '../../common/service-names';
import renderTemplate from '../render-template';
import {
  processOrientationOption,
  TemplateConfig,
} from '../../browser/helpers';
import { SendingFailedError, PDFNotFoundError } from '../errors';
import config from '../../common/config';
import { PreviewReqBody, PreviewReqQuery } from '../../common/types';
import previewPdf from '../../browser/previewPDF';
import pool from '../workers';

export type PreviewHandlerRequest = Request<
  unknown,
  unknown,
  PreviewReqBody,
  PreviewReqQuery
>;

export type GenerateHandlerRequest = Request<
  unknown,
  unknown,
  Record<string, any>,
  { service: ServiceNames; template: string }
>;

export type HelloHandlerRequest = Request<
  unknown,
  unknown,
  unknown,
  { policyId: string; totalHostCount: number }
>;

export type PuppeteerBrowserRequest = Request<
  unknown,
  unknown,
  unknown,
  { service: ServiceNames; template: string }
>;

export type PdfRequestBody = {
  url: string;
  templateConfig: TemplateConfig;
  templateData?: Record<string, unknown>;
  orientationOption?: boolean;
  rhIdentity: string;
  dataOptions: Record<string, any>;
};

const router = Router();

function getPdfRequestBody(
  config: any,
  req: GenerateHandlerRequest
): PdfRequestBody {
  const rhIdentity = httpContext.get(config?.IDENTITY_HEADER_KEY as string);
  const orientationOption = processOrientationOption(req);
  const service = req.body.service;
  const template = req.body.template;
  const dataOptions = req.body;
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
  };
}

// Middleware that activates on all routes, responsible for rendering the correct
// template/component into html to the requester.
router.use('^/$', async (req: PuppeteerBrowserRequest, res, _next) => {
  let service: ServiceNames = req.query.service;
  let template: string = req.query.template;
  if (!service) {
    console.info('Missing service, using "demo"');
    service = ServiceNames.demo;
  }
  if (!template) {
    console.info('Missing template, using "demo"');
    template = 'demo';
  }

  const templateConfig = {
    service,
    template,
  };
  try {
    const configHeaders: string | string[] | undefined =
      req.headers[config?.OPTIONS_HEADER_NAME as string];
    if (configHeaders) {
      delete req.headers[config?.OPTIONS_HEADER_NAME as string];
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

router.get(`${config?.APIPrefix}/hello`, (_req, res) => {
  return res.status(200).send('<h1>Well this works!</h1>');
});

router.post(
  `${config?.APIPrefix}/generate`,
  async (req: GenerateHandlerRequest, res, next) => {
    const pdfDetails = getPdfRequestBody(config, req);
    console.log(pool.stats());

    try {
      const pathToPdf = await pool.exec<(...args: any[]) => string>(
        'generatePdf',
        [pdfDetails]
      );

      const pdfFileName = pathToPdf.split('/').pop();

      if (!fs.existsSync(pathToPdf)) {
        throw new PDFNotFoundError(pdfFileName as string);
      }
      return res.status(200).sendFile(pathToPdf, (err) => {
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
      });
    } catch (error: any) {
      const errStr = `${error}`;
      if (errStr.includes('No API descriptor')) {
        res.status(400).send({
          error: {
            status: 400,
            statusText: 'Bad Request',
            description: `${error}`,
          },
        });
      } else {
        res.status(500).send({
          error: {
            status: 500,
            statusText: 'Internal server error',
            description: `${error}`,
          },
        });
      }
      next(`There was an error while generating a report: ${error}`);
    } finally {
      // To handle the edge case where a pool terminates while the queue isn't empty,
      // we ensure that the queue is empty and all workers are idle.
      const stats = pool.stats();
      console.log(stats);
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
      // console.info('error', `${error.code}: ${error.message}`);
      console.info('error', `${error.message}`);
      // res.status((error.code as number) || 500).send(error.message);
      res.status(500).send(error.message); // only here as example, we don't want to force a 500 every time.
    }
  }
});

router.get('/healthz', (_req, res, _next) => {
  return res.status(200).send('Build assets available');
});

router.get(`${config?.APIPrefix}/openapi.json`, (_req, res, _next) => {
  fs.readFile('./docs/openapi.json', 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .send(`An error occurred while fetching the OpenAPI spec : ${err}`);
    } else {
      return res.json(JSON.parse(data));
    }
  });
});

export default router;
