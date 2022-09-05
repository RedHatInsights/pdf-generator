import fs from 'fs';
import { Router, Request } from 'express';
import type { IncomingHttpHeaders } from 'http';

import { OPTIONS_HEADER_NAME } from '../';
import getTemplateData from '../data-access';
import ServiceNames from '../data-access/service-names';
import renderTemplate from '../render-template';
import { processOrientationOption } from '../../browser/helpers';
import generatePdf, { previewPdf } from '../../browser';
import { SendingFailedError, PDFNotFoundError } from '../errors';
import config from '../config';

const PORT = config.webPort;

type PreviewOptions = unknown;
type ReqQuery = {
  orientation?: string;
  template: string;
  service: ServiceNames;
};
type PreviewHandlerRequest = Request<PreviewOptions, any, unknown, ReqQuery>;

export type GenerateHandlerReqyest = Request<
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

export interface PupetterBrowserRequest
  extends Request<
    unknown,
    unknown,
    unknown,
    { service: ServiceNames; template: string }
  > {
  headers: IncomingHttpHeaders & {
    [OPTIONS_HEADER_NAME]?: string;
  };
}

const APIPrefix = '/api/crc-pdf-generator/v1';

const router = Router();

// Middlware that activates on all routes, responsible for rendering the correct
// template/component into html to the requester.
router.use('^/$', async (req: PupetterBrowserRequest, res, _next) => {
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
    const configHeaders: string | undefined = req.headers[OPTIONS_HEADER_NAME];
    if (configHeaders) {
      delete req.headers[OPTIONS_HEADER_NAME];
    }

    const templateData = await getTemplateData(
      req.headers,
      templateConfig,
      configHeaders ? JSON.parse(configHeaders) : undefined
    );
    const HTMLTemplate: string = renderTemplate(
      templateConfig,
      templateData as Record<string, unknown>
    );
    res.send(HTMLTemplate);
  } catch (error) {
    console.log(error);
    res.send(`<div>Unable to render ${template}!</div>`);
  }
});

router.get(`${APIPrefix}/hello`, (_req, res) => {
  return res.status(200).send('<h1>Well this works!</h1>');
});

router.post(
  `${APIPrefix}/generate`,
  async (req: GenerateHandlerReqyest, res) => {
    const rhIdentity = req.headers['x-rh-identity'] as string;
    const orientationOption = processOrientationOption(req);

    if (!rhIdentity) {
      return res.status(401).send('Unauthorized access not allowed');
    }

    const service = req.body.service;
    const template = req.body.template;
    const dataOptions = req.body;

    const tenant = JSON.parse(atob(rhIdentity))['identity']['internal'][
      'org_id'
    ];
    const url = `http://localhost:${PORT}?template=${template}&service=${service}`;

    try {
      // Generate the pdf
      const pathToPdf = await generatePdf(
        url,
        rhIdentity,
        {
          service,
          template,
        },
        orientationOption,
        dataOptions
      );

      const pdfFileName = pathToPdf.split('/').pop();

      if (!fs.existsSync(pathToPdf)) {
        throw new PDFNotFoundError(pdfFileName);
      }

      res.status(200).sendFile(pathToPdf, (err) => {
        if (err) {
          const errorMessage = new SendingFailedError(pdfFileName, err);
          throw errorMessage;
        }

        fs.unlink(pathToPdf, (err) => {
          if (err) {
            console.info('warn', `Failed to unlink ${pdfFileName}: ${err}`, {
              tenant,
            });
          }
        });
      });
    } catch (error) {
      res.status((error.code as number) || 500).send(error.message);
    }
  }
);

router.get(`/preview`, async (req: PreviewHandlerRequest, res) => {
  const service: ServiceNames = req.query.service;
  const template: string = req.query.service;
  const templateData = await getTemplateData(req.headers, {
    service,
    template,
  });
  const orientationOption = processOrientationOption(req);

  const url = `http://localhost:${PORT}?template=${template}`;
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
  } catch (error) {
    console.info('error', `${error.code}: ${error.message}`);
    res.status((error.code as number) || 500).send(error.message);
  }
});

router.get('/healthz', (_req, res, _next) => {
  return res.status(200).send('Build assets available');
});

export default router;