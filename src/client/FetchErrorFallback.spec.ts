import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FetchErrorFallback, { RENDER_FAILED } from './FetchErrorFallback';

const render = (error?: unknown) =>
  renderToStaticMarkup(createElement(FetchErrorFallback, { error }));

const wrapped = (message: string) =>
  `<div id="crc-pdf-generator-err"><div>${message}</div></div>`;

describe('FetchErrorFallback', () => {
  // Puppeteer treats an empty #crc-pdf-generator-err as a blank render, so every
  // branch must leave a message behind.
  it('renders a message when no error is passed', () => {
    expect(render()).toBe(wrapped(RENDER_FAILED));
  });

  it('renders the message of an Error', () => {
    expect(render(new Error('boom'))).toBe(wrapped('boom'));
  });

  it('falls back when an Error has no message', () => {
    expect(render(new Error(''))).toBe(wrapped(RENDER_FAILED));
  });

  it('renders a string error', () => {
    expect(render('boom')).toBe(wrapped('boom'));
  });

  it('falls back for an empty string error', () => {
    expect(render('')).toBe(wrapped(RENDER_FAILED));
  });

  it('renders the message of an error-like object', () => {
    expect(render({ message: 'boom' })).toBe(wrapped('boom'));
  });

  it('falls back when an error-like object has an empty message', () => {
    expect(render({ message: '' })).toBe(wrapped(RENDER_FAILED));
  });

  it('serializes any other error', () => {
    expect(render({ status: 500 })).toContain('&quot;status&quot;: 500');
  });
});
