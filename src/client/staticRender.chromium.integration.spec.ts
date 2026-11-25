/**
 * Runs renderStatically in real Chromium with real React. It builds DOM, so
 * only a browser can show that the copy is what React would have mounted.
 */
import fs from 'fs';
import path from 'path';
import puppeteer, { Browser, Page } from 'puppeteer';
import ts from 'typescript';
import { PDF_LOADING_ATTR } from './pdfReady';

let browser: Browser;
let page: Page;

/** staticRender.ts compiled for the page, with its imports mapped to globals. */
const moduleForPage = () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'staticRender.ts'),
    'utf8',
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  return `window.staticRender = (() => {
    const exports = {};
    const modules = {
      react: React,
      'react-dom': ReactDOM,
      'react-dom/client': ReactDOM,
      './pdfReady': { PDF_LOADING_ATTR: ${JSON.stringify(PDF_LOADING_ATTR)} },
    };
    const require = (name) => modules[name];
    ${outputText}
    return exports;
  })();`;
};

beforeAll(async () => {
  browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-gpu', '--no-zygote', '--no-first-run'],
  });
  page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  // The browser builds of React, which define the React and ReactDOM globals.
  for (const [name, file] of [
    ['react', 'umd/react.production.min.js'],
    ['react-dom', 'umd/react-dom.production.min.js'],
  ]) {
    const root = path.dirname(require.resolve(`${name}/package.json`));
    await page.addScriptTag({ path: path.join(root, file) });
  }
  await page.addScriptTag({ content: moduleForPage() });
}, 60000);

afterAll(async () => {
  await browser?.close();
});

/**
 * Runs `scenario` in the page. It gets React's createElement as `h` and
 * returns the template to render; `probe` reads the result, or the scenario
 * resolves to null when the template is to be mounted instead.
 */
const render = <T>(scenario: string, probe: string) =>
  page.evaluate(`(() => {
    const h = React.createElement;
    const Template = (${scenario})(h);
    const rendered = staticRender.renderStatically(Template, {});
    return rendered ? (${probe})(rendered) : null;
  })()`) as Promise<T | null>;

describe('renderStatically', () => {
  it('copies the elements React builds', async () => {
    const html = await render<string>(
      `(h) => () => h('table', { className: 'report' },
        h('tbody', null, h('tr', null, h('td', { title: 'a' }, 'host-', 1))))`,
      `(rendered) => rendered.innerHTML`,
    );

    expect(html).toBe(
      '<table class="report"><tbody><tr><td title="a">host-1</td></tr></tbody></table>',
    );
  });

  it('keeps nesting and tags that parsing HTML would change', async () => {
    const outline = await render<string[]>(
      `(h) => () => h('div', null,
        h('p', null, 'intro', h('div', null, 'block')),
        h('table', null, h('thead', null, h('th', null, 'Name'))),
        h('TEXT', null, 'label'))`,
      `(rendered) => Array.from(rendered.querySelectorAll('*'), (element) => {
        let depth = 0;
        for (let up = element.parentNode; up !== rendered; up = up.parentNode) depth++;
        return depth + ':' + element.localName;
      })`,
    );

    expect(outline).toEqual([
      '0:div',
      '1:p',
      '2:div',
      '1:table',
      '2:thead',
      '3:th',
      '1:text',
    ]);
  });

  it('keeps charts as SVG', async () => {
    expect(
      await render<boolean>(
        `(h) => () => h('svg', { viewBox: '0 0 1 1' }, h('path', { d: 'M0 0' }))`,
        `(rendered) => rendered.firstElementChild instanceof SVGSVGElement`,
      ),
    ).toBe(true);
  });

  it('keeps report data as text', async () => {
    const name =
      '"><img src=x onerror="window.injected = true"><script>x</script>';

    const result = await render<{ text: string; elements: number }>(
      `(h) => () => h('td', { title: ${JSON.stringify(name)} }, ${JSON.stringify(name)})`,
      `(rendered) => ({
        text: rendered.textContent,
        title: rendered.querySelector('td').title,
        elements: rendered.querySelectorAll('*').length,
        injected: window.injected ?? false,
      })`,
    );

    expect(result).toEqual({
      text: name,
      title: name,
      elements: 1,
      injected: false,
    });
  });

  it('includes what the first render writes to the DOM as it commits', async () => {
    expect(
      await render<string>(
        `(h) => () => {
          const ref = React.useRef(null);
          React.useLayoutEffect(() => { ref.current.dataset.measured = 'yes'; }, []);
          return h('p', { ref }, 'text');
        }`,
        `(rendered) => rendered.firstElementChild.dataset.measured`,
      ),
    ).toBe('yes');
  });

  it('copies the first render only, not a later state update', async () => {
    expect(
      await render<string>(
        `(h) => () => {
          const [label, setLabel] = React.useState('first');
          React.useEffect(() => setLabel('later'), []);
          return h('p', null, label);
        }`,
        `(rendered) => rendered.textContent`,
      ),
    ).toBe('first');
  });

  it('leaves nothing mounted', async () => {
    expect(
      await render<boolean>(
        `(h) => () => {
          React.useEffect(() => () => { window.cleanedUp = true; }, []);
          return h('p', null, 'done');
        }`,
        `() => window.cleanedUp === true`,
      ),
    ).toBe(true);
  });

  it.each([
    ['throws', `(h) => () => { throw new Error('boom'); }`],
    [
      'throws inside a Suspense boundary',
      `(h) => () => h(React.Suspense, { fallback: h('p', null, 'Loading...') },
        h(() => { throw new Error('boom'); }))`,
    ],
    [
      'is still showing a loading placeholder',
      `(h) => () => h('div', { ${JSON.stringify(PDF_LOADING_ATTR)}: '' }, 'Loading...')`,
    ],
    ['renders nothing', `(h) => () => null`],
  ])(
    'asks for the template to be mounted when it %s',
    async (_case, scenario) => {
      expect(await render(scenario, `() => true`)).toBeNull();
    },
  );
});
