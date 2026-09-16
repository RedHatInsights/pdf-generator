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

// These placeholders live in HTML produced elsewhere — a bundler for index.html,
// files on disk for the header and footer — so they are not guaranteed to survive
// a toolchain change. webpack 5.110 began emitting `<script id=initial-state>`
// without quotes, and the exact-match replace below silently returned the input
// unchanged: no injected state, a page that never mounted, and a blank PDF the
// pipeline happily reported as Generated. Match either quoting, and fail loudly
// when the placeholder is gone entirely.
const INITIAL_STATE_PLACEHOLDER =
  /<script id=["']?initial-state["']?\s*>\s*<\/script>/;
const CONTENT_PLACEHOLDER = /<div id=["']?content["']?\s*>\s*<\/div>/;

function substitutePlaceholder(
  template: string,
  placeholder: RegExp,
  replacement: string,
  source: string,
): string {
  if (!placeholder.test(template)) {
    throw new Error(
      `Placeholder ${String(placeholder)} not found in ${source} — refusing to render a document with no content`,
    );
  }
  // Replacement passed as a function: the injected JSON can legitimately contain
  // `$&`, `$'` and friends, which String.replace would otherwise expand.
  return template.replace(placeholder, () => replacement);
}

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
    headerTemplate: substitutePlaceholder(
      headerBase,
      CONTENT_PLACEHOLDER,
      renderToStaticMarkup(
        <Header brand={brand} logoSvg={lightwellSvg ?? undefined} />,
      ),
      'public/templates/header-template.html',
    ),
    footerTemplate: substitutePlaceholder(
      footerBase,
      CONTENT_PLACEHOLDER,
      renderToStaticMarkup(<Footer />),
      'public/templates/footer-template.html',
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

  return substitutePlaceholder(
    baseTemplate,
    INITIAL_STATE_PLACEHOLDER,
    `<script id="initial-state">window.__initialState__ = ${safeJsonStringify(payload)};
window.__endpoints__ = ${safeJsonStringify(endpointKeys)}
window.IS_PRODUCTION = ${instanceConfig.IS_PRODUCTION}</script>`,
    'dist/public/index.html',
  );
}

export default renderTemplate;
