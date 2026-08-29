import fs from 'fs';
import path from 'path';
import { GeneratePayload } from '../../common/types';
import { renderToStaticMarkup } from 'react-dom/server';
import Header from './Header';
import Footer from './Footer';
import instanceConfig from '../../common/config';
import { safeJsonStringify } from '../utils';
import { HeaderBrand, resolveHeaderBrand } from './HeaderLogo';

export type { HeaderBrand };
export { resolveHeaderBrand };

const cachedTemplates: Partial<
  Record<string, { headerTemplate: string; footerTemplate: string }>
> = {};

export function getHeaderAndFooterTemplates(
  brand: HeaderBrand = 'redhat',
  lightwellSvg?: string | null,
): {
  headerTemplate: string;
  footerTemplate: string;
} {
  // Lightwell with a logo SVG is dynamic (sourced from frontend-assets at runtime),
  // so we skip caching for that case. Red Hat and Lightwell-without-logo are static.
  const cacheKey = brand === 'lightwell' && lightwellSvg ? null : brand;

  if (cacheKey) {
    const cached = cachedTemplates[cacheKey];
    if (cached) {
      return cached;
    }
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

  const templates = {
    headerTemplate: headerBase.replace(
      '<div id="content"></div>',
      renderToStaticMarkup(
        <Header brand={brand} logoSvg={lightwellSvg ?? undefined} />,
      ),
    ),
    footerTemplate: footerBase.replace(
      '<div id="content"></div>',
      renderToStaticMarkup(<Footer />),
    ),
  };

  if (cacheKey) {
    cachedTemplates[cacheKey] = templates;
  }

  return templates;
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
    `<script id="initial-state">window.__initialState__ = ${safeJsonStringify(payload)};
window.__endpoints__ = ${safeJsonStringify(endpointKeys)}
window.IS_PRODUCTION = ${instanceConfig.IS_PRODUCTION}</script>`,
  );

  return template;
}

export default renderTemplate;
