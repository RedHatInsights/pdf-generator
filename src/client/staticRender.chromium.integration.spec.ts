/**
 * Runs parseAsRendered in real Chromium. Whether static markup becomes the DOM
 * React would have built depends on the browser's parsers, which no mock can
 * stand in for.
 */
import { createElement } from 'react';
import puppeteer, { Browser, Page } from 'puppeteer';
import { parseAsRendered, renderToMarkup } from './staticRender';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-gpu', '--no-zygote', '--no-first-run'],
  });
  page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
}, 60000);

afterAll(async () => {
  await browser?.close();
});

/**
 * Parses `html` in the page and returns what `probe` reads from the result,
 * or null when the markup was rejected.
 */
const parse = <T>(html: string, probe: (parsed: HTMLElement) => T) =>
  page.evaluate(
    `(() => {
      const parsed = (${parseAsRendered.toString()})(${JSON.stringify(html)});
      return parsed ? (${probe.toString()})(parsed) : null;
    })()`,
  ) as Promise<T | null>;

const outline = (parsed: HTMLElement) =>
  Array.from(parsed.querySelectorAll('*'), (element) => {
    let depth = 0;
    for (let up = element.parentNode; up !== parsed; up = up!.parentNode) {
      depth++;
    }
    return `${depth}:${element.localName}`;
  });

describe('parseAsRendered', () => {
  it('builds the elements as real HTML elements', async () => {
    const result = await parse(
      '<div class="report"><h1>Title</h1><br/><input disabled=""/></div>',
      (parsed) => ({
        html: parsed.innerHTML,
        isDiv: parsed.firstElementChild instanceof HTMLDivElement,
        disabled: parsed.querySelector('input')?.disabled,
      }),
    );

    expect(result).toEqual({
      html: '<div class="report"><h1>Title</h1><br><input disabled=""></div>',
      isDiv: true,
      disabled: true,
    });
  });

  it('keeps nesting the HTML parser would rearrange', async () => {
    expect(await parse('<p>intro<div>block</div>outro</p>', outline)).toEqual([
      '0:p',
      '1:div',
    ]);
    expect(
      await parse(
        '<table><thead><th>Name</th></thead><tr><td>a</td></tr></table>',
        outline,
      ),
    ).toEqual(['0:table', '1:thead', '2:th', '1:tr', '2:td']);
  });

  it('gives charts the SVG namespace', async () => {
    const result = await parse(
      '<div><svg viewBox="0 0 1 1"><linearGradient id="g"></linearGradient><path d="M0 0"></path></svg></div>',
      (parsed) => ({
        svg: parsed.querySelector('svg') instanceof SVGSVGElement,
        gradient:
          parsed.querySelector('linearGradient') instanceof
          SVGLinearGradientElement,
      }),
    );

    expect(result).toEqual({ svg: true, gradient: true });
  });

  it('accepts an svg that names its own namespace', async () => {
    expect(
      await parse(
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"></path></svg>',
        (parsed) => parsed.firstElementChild instanceof SVGSVGElement,
      ),
    ).toBe(true);
  });

  it('keeps report data as text', async () => {
    const Cell = ({ name }: { name: string }) =>
      createElement('td', { title: name }, name);
    const name = '"><img src=x onerror="window.injected = true">&amp;<b>';

    const result = await parse(renderToMarkup(Cell, { name }), (parsed) => ({
      text: parsed.textContent,
      title: parsed.querySelector('td')?.title,
      elements: parsed.querySelectorAll('*').length,
      injected: (window as { injected?: boolean }).injected ?? false,
    }));

    expect(result).toEqual({
      text: name,
      title: name,
      elements: 1,
      injected: false,
    });
  });

  it.each([
    ['is not well-formed', '<div><br></div>'],
    ['uses an entity XML does not know', '<p>a&nbsp;b</p>'],
    [
      'puts HTML inside an SVG',
      '<svg><foreignObject><p>x</p></foreignObject></svg>',
    ],
    ['writes an HTML tag in upper case', '<DIV>x</DIV>'],
  ])('rejects markup that %s', async (_reason, html) => {
    expect(await parse(html, () => true)).toBeNull();
  });
});
