import fs from 'fs';
import path from 'path';
import { GeneratePayload } from '../../common/types';
import { renderToStaticMarkup } from 'react-dom/server';
import Header from './Header';
import Footer from './Footer';
import instanceConfig from '../../common/config';

export function getHeaderAndFooterTemplates(): {
  headerTemplate: string;
  footerTemplate: string;
} {
  const root = process.cwd();
  const headerBase = fs.readFileSync(
    path.resolve(root, 'public/templates/header-template.html'),
    { encoding: 'utf-8' },
  );

  const footerBase = fs.readFileSync(
    path.resolve(root, 'public/templates/footer-template.html'),
    { encoding: 'utf-8' },
  );

  return {
    headerTemplate: headerBase.replace(
      '<div id="content"></div>',
      renderToStaticMarkup(<Header />),
    ),
    footerTemplate: footerBase.replace(
      '<div id="content"></div>',
      renderToStaticMarkup(<Footer />),
    ),
  };
}

function renderTemplate(payload: GeneratePayload) {
  const root = process.cwd();
  const baseTemplate = fs.readFileSync(
    path.resolve(root, 'dist/public/index.html'),
    { encoding: 'utf-8' },
  );

  const template = baseTemplate.replace(
    '<script id="initial-state"></script>',
    `<script id="initial-state">window.__initialState__ = ${JSON.stringify(
      payload,
      null,
      2,
    )};
window.__endpoints__ = ${JSON.stringify(instanceConfig.endpoints, null, 2)}
window.IS_PRODUCTION = ${instanceConfig.IS_PRODUCTION}</script>`,
  );

  return template;
}

export default renderTemplate;
