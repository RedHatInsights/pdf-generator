# Integration Guidelines

## Architecture Overview

pdf-generator is a Node.js/Express service that generates PDFs from React components using Puppeteer. The flow:

1. Client sends `POST /api/crc-pdf-generator/v2/create` with Scalprum module config
2. Server queues PDF generation via `puppeteer-cluster`
3. Puppeteer loads a local URL (`/puppeteer`) that SSR-renders the React template
4. The rendered page is printed to PDF via `page.pdf()`
5. PDF is uploaded to S3 (MinIO locally)
6. Client polls `GET /v2/status/:statusID`, then downloads via `GET /v2/download/:ID`

## Module Federation / Scalprum

- PDF templates are loaded as federated React modules via Scalprum (`@scalprum/core`, `@scalprum/react-core`).
- Each template is identified by `{ manifestLocation, scope, module }` — matching the pattern used by Hybrid Cloud Console frontend apps.
- The `/puppeteer` route renders templates server-side via `renderTemplate()` in `src/server/render-template/index.tsx`.
- Template components must be SSR-compatible — no `window`, `document`, or other browser-only APIs.
- The `PagesMaker` component in `src/server/render-template/PagesMaker.tsx` wraps template content with headers and footers.

## Puppeteer Cluster

- `src/server/cluster.ts` manages a `puppeteer-cluster` instance with `CONCURRENCY_CONTEXT` mode.
- Default concurrency: 2 workers (configurable via `MAX_CONCURRENCY` env var).
- Retry limit: 2 attempts per task.
- The cluster is initialized at module load (top-level `await`) and never closed during the server's lifetime.
- Each PDF generation task gets a fresh page context. Pages are closed in the `finally` block.

## S3 Object Store

- `src/common/store/` implements PDF storage with an S3-compatible backend (MinIO for local dev, AWS S3 in production).
- The `store` singleton is initialized via `store.intialize(StoreType.S3)` at server startup (note: the method name has a typo in the source — `intialize` not `initialize`).
- PDFs are uploaded with UUID-based keys and downloaded as readable streams.
- Bucket: `crc-generated-pdfs`.

## Kafka

- Topic: `pdf-generator.updated.report` (defined in `src/browser/constants.ts`).
- Producer: `UpdateStatus()` sends status messages after each generation step.
- Consumer: `consumeMessages()` subscribes at startup, updates `PdfCache` with messages from other pods (multi-replica sync).
- Consumer group: `pdf-gen-<hostname>` — each pod has its own consumer group.
- SSL/SASL config is auto-detected from Clowder broker config.

## Clowder / app-common-js

- `app-common-js` provides `Config`, `IsClowderEnabled()`, and types for Clowder-managed resources.
- When Clowder is enabled, config is loaded from the Clowder JSON file — overriding defaults for S3, Kafka, and service endpoints.
- Service endpoints (other HCC microservices) are registered from `clowderConfig.endpoints` and `clowderConfig.privateEndpoints`.

## Docker / Container

- Multi-stage build: `ubi9/nodejs-22` builder → `ubi9/nodejs-22-minimal` runtime.
- Chrome dependencies installed via `microdnf` in the runtime stage.
- Chrome binary copied from Puppeteer cache at `/opt/app-root/src/.cache/puppeteer`.
- `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` set to `/tmp/.chromium` for rootless operation.

## PatternFly CSS

- Both PF5 (`pf-5-styles` alias) and PF6 (`@patternfly/patternfly`) are dependencies.
- CSS is loaded for PDF template rendering — templates use PatternFly components for consistent styling.

## Prometheus Metrics

- Metrics exposed on port 9001 at `/metrics` via `express-prom-bundle`.
- Collects default Node.js metrics plus per-route method/path/status code metrics.
- Health check: `GET /healthz` returns 200.

## API Documentation

- OpenAPI spec at `docs/openapi.json`, served via `GET /api/crc-pdf-generator/v1/openapi.json`.
- Validate spec with: `npm run api:validate` (uses `@quobix/vacuum`).
