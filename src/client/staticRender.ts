import { ComponentType, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * A report is printed once and never interacted with, so a template is
 * rendered once to static DOM instead of staying mounted. Its components still
 * produce the markup, but none keep state, effects or layout reads alive.
 *
 * Nothing the template does after its first render runs. A template that
 * needs that opts out by sending `additionalData.staticRender: false`.
 */
export const usesStaticRender = (additionalData?: Record<string, unknown>) =>
  additionalData?.staticRender !== false;

/**
 * Turns static markup into DOM, or returns undefined when the DOM would not be
 * the one React builds when it mounts the template.
 *
 * The markup is parsed as XML, which keeps the nesting exactly as written.
 * The HTML parser would rearrange a div inside a p or a thead without a tr.
 * Markup XML cannot read is rejected, and the result is checked tag by tag.
 *
 * Self-contained, so the browser test can run it in a real page.
 */
export function parseAsRendered(html: string): HTMLElement | undefined {
  // HTML inside an SVG would be read as SVG.
  if (/<foreignObject[\s>]/.test(html)) {
    return undefined;
  }
  const namespaces: Record<string, string> = {
    svg: 'http://www.w3.org/2000/svg',
    math: 'http://www.w3.org/1998/Math/MathML',
  };
  const markup = html.replace(
    /<(svg|math)(?=[\s>])(?![^<>]*\sxmlns=)/g,
    (tag, name: string) => `${tag} xmlns="${namespaces[name]}"`,
  );
  const parsed = new DOMParser().parseFromString(
    `<div xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink">${markup}</div>`,
    'application/xhtml+xml',
  );
  if (parsed.getElementsByTagName('parsererror').length > 0) {
    return undefined;
  }
  const container = document.adoptNode(parsed.documentElement);

  const elements = document.createTreeWalker(
    container,
    NodeFilter.SHOW_ELEMENT,
  );
  const depthOf = (element: Node) => {
    let depth = 0;
    for (let parent = element.parentNode; parent !== container; depth++) {
      parent = parent?.parentNode ?? container;
    }
    return depth;
  };
  // React escapes < and > in text and attribute values, so every match is a tag.
  const tag = /<(\/?)([a-zA-Z][^\s/>]*)[^<>]*?(\/?)>/g;
  let depth = 0;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    if (match[1]) {
      depth--;
      continue;
    }
    const element = elements.nextNode() as Element | null;
    if (
      !element ||
      element.localName !== match[2] ||
      depthOf(element) !== depth ||
      // XML keeps the case of a tag, and <DIV> is not an HTML div there.
      (element instanceof HTMLElement && match[2] !== match[2].toLowerCase())
    ) {
      return undefined;
    }
    if (!match[3]) {
      depth++;
    }
  }
  return elements.nextNode() ? undefined : container;
}

/**
 * React's own renderer escapes every text and attribute value, so report data
 * cannot turn into markup.
 */
export const renderToMarkup = <Props extends object>(
  Template: ComponentType<Props>,
  props: Props,
) => renderToStaticMarkup(createElement(Template, props));

/**
 * Renders the template to static DOM. Returns undefined to have it mounted
 * instead: when it throws, or when its markup cannot be reproduced exactly.
 */
export function renderStatically<Props extends object>(
  Template: ComponentType<Props>,
  props: Props,
): HTMLElement | undefined {
  try {
    const rendered = parseAsRendered(renderToMarkup(Template, props));
    if (!rendered) {
      console.log(
        '[crc-pdf-generator] static markup cannot be reproduced exactly; mounting the template',
      );
    }
    return rendered;
  } catch (error) {
    console.error(
      '[crc-pdf-generator] static render failed; mounting the template',
      error,
    );
    return undefined;
  }
}
