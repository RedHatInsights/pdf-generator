import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HeaderLogo, { resolveHeaderBrand } from './HeaderLogo';

describe('resolveHeaderBrand', () => {
  it('defaults to Red Hat branding', () => {
    expect(resolveHeaderBrand()).toBe('redhat');
    expect(resolveHeaderBrand({})).toBe('redhat');
    expect(resolveHeaderBrand({ headerBrand: 'unknown' })).toBe('redhat');
  });

  it('selects Lightwell branding when requested', () => {
    expect(resolveHeaderBrand({ headerBrand: 'lightwell' })).toBe('lightwell');
  });
});

describe('HeaderLogo', () => {
  it('renders Red Hat logo by default', () => {
    const html = renderToStaticMarkup(createElement(HeaderLogo));
    expect(html).toContain('Layer_1');
    expect(html).not.toContain('Lightwell');
  });

  it('renders Lightwell text when brand is lightwell but no logoSvg', () => {
    const html = renderToStaticMarkup(
      createElement(HeaderLogo, { brand: 'lightwell' }),
    );
    expect(html).toContain('Lightwell');
    expect(html).not.toContain('<svg');
  });

  it('renders Lightwell with logo SVG when provided', () => {
    const svg = '<svg viewBox="0 0 28 28"><circle r="14"/></svg>';
    const html = renderToStaticMarkup(
      createElement(HeaderLogo, { brand: 'lightwell', logoSvg: svg }),
    );
    expect(html).toContain('Lightwell');
    expect(html).toContain(svg);
  });
});
