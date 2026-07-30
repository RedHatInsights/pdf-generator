import fs from 'fs';
import path from 'path';
import { GeneratePayload } from '../../common/types';
import { renderToStaticMarkup } from 'react-dom/server';
import Header from './Header';
import Footer from './Footer';
import instanceConfig from '../../common/config';

let cachedTemplates: {
  headerTemplate: string;
  footerTemplate: string;
} | null = null;

export function getHeaderAndFooterTemplates(): {
  headerTemplate: string;
  footerTemplate: string;
} {
  if (cachedTemplates) {
    return cachedTemplates;
  }

  const root = process.cwd();
  const headerBase = fs.readFileSync(
    path.resolve(root, 'public/templates/header-template.html'),
    { encoding: 'utf-8' },
  );

  const footerBase = fs.readFileSync(
    path.resolve(root, 'public/templates/footer-template.html'),
    { encoding: 'utf-8' },
  );

  cachedTemplates = {
    headerTemplate: headerBase.replace(
      '<div id="content"></div>',
      renderToStaticMarkup(<Header />),
    ),
    footerTemplate: footerBase.replace(
      '<div id="content"></div>',
      renderToStaticMarkup(<Footer />),
    ),
  };

  return cachedTemplates;
}

function renderTemplate(payload: GeneratePayload) {
  const root = process.cwd();
  const baseTemplate = fs.readFileSync(
    path.resolve(root, 'dist/public/index.html'),
    { encoding: 'utf-8' },
  );

  // Only expose endpoint keys to the browser — never leak internal hostnames/ports.
  const endpoints = instanceConfig.endpoints;
  const endpointKeys = Object.fromEntries(
    (Object.keys(endpoints) as Array<keyof typeof endpoints>).map((k) => [
      k,
      { app: endpoints[k]?.app ?? k, name: '' },
    ]),
  );

  const template = baseTemplate.replace(
    '<script id="initial-state"></script>',
    `<script id="initial-state">window.__initialState__ = ${JSON.stringify(
      payload,
      null,
      2,
    )};
window.__endpoints__ = ${JSON.stringify(endpointKeys, null, 2)}
window.IS_PRODUCTION = ${instanceConfig.IS_PRODUCTION}</script>`,
  );

  return template;
}

export default renderTemplate;
