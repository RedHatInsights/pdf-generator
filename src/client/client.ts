import 'pf-5-styles/patternfly.min.css';
import 'pf-5-styles/patternfly-addons.css';
import '@patternfly/patternfly/patternfly.min.css';
import '@patternfly/patternfly/patternfly-addons.css';
import { markPdfPending, markPdfReady } from './pdfReady';

// Tell the generator this page reports its own readiness (see pdfReady.ts).
// The generator looks for the flag at DOMContentLoaded, so this must stay in
// the entry chunk, which is loaded as a deferred script.
markPdfPending();

import('./bootstrap').catch((error) => {
  // If the app cannot even start, let the generator's blank/error checks fail
  // the report now rather than waiting out the browser timeout.
  console.error('[crc-pdf-generator] failed to start the report app', error);
  markPdfReady();
});
