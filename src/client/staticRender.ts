import { ComponentType, createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { PDF_LOADING_ATTR } from './pdfReady';

/**
 * A report is printed once and never interacted with, so a template does not
 * stay mounted. A template that needs to opts out by sending
 * `additionalData.staticRender: false`.
 */
export const usesStaticRender = (additionalData?: Record<string, unknown>) =>
  additionalData?.staticRender !== false;

/**
 * Builds the template off-screen, copies the finished elements and unmounts
 * it. React creates the elements exactly as it does on the page, but none of
 * the components stay alive while the report prints. Only the first render is
 * copied: a state update made after it is not.
 *
 * Returns undefined to have the template mounted on the page instead: when it
 * throws, renders nothing, or is still showing a loading placeholder.
 */
export function renderStatically<Props extends object>(
  Template: ComponentType<Props>,
  props: Props,
): HTMLElement | undefined {
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    flushSync(() => root.render(createElement(Template, props)));
    // Runs the effects of that render, so what they write to the DOM is copied.
    flushSync(() => undefined);
    const stillLoading = container.querySelector(`[${PDF_LOADING_ATTR}]`);
    if (!container.hasChildNodes() || stillLoading) {
      return undefined;
    }
    return container.cloneNode(true) as HTMLElement;
  } catch (error) {
    console.error(
      '[crc-pdf-generator] static render failed; mounting the template',
      error,
    );
    return undefined;
  } finally {
    root.unmount();
  }
}
