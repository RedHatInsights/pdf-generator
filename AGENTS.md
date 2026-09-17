# Agent Onboarding: crc-pdf-generator

A Node.js/Express service that generates PDF reports from federated React components using headless Chromium (Puppeteer). Deployed on OpenShift as part of the Hybrid Cloud Console (HCC) platform.

## Project Structure

```
src/
  browser/          # Puppeteer page tasks and helpers
    clusterTask.ts  # Core PDF generation logic (page load → render → print → upload)
    previewPDF.ts   # Single-page preview generation
    helpers.ts      # Page dimensions, Chrome path, window property injection
    constants.ts    # Kafka topic name
  client/           # Browser-side entry point (for preview mode)
  common/           # Shared utilities
    config.ts       # Clowder-aware configuration (S3, Kafka, endpoints)
    kafka.ts        # Kafka producer/consumer (status sync across pods)
    pdfCache.ts     # In-memory PDF status cache (state machine)
    logging.ts      # Winston loggers (apiLogger, hpmLogger, requestLogger)
    store/          # S3 object store abstraction
  integration/      # Service endpoint definitions
  middleware/       # Express middleware (identity extraction)
  server/           # Express app, routes, cluster, template rendering
    routes/         # API route handlers (v2/create, v2/status, v2/download)
    render-template/# SSR React rendering (headers, footers, page layout)
    cluster.ts      # Puppeteer cluster initialization
    errors.ts       # Custom error classes
    utils.ts        # Status update helpers, input sanitization
config/             # Webpack configuration
docs/               # API docs, onboarding guides, OpenAPI spec
.tekton/            # Konflux CI pipeline definitions
```

## Tech Stack

- **Runtime**: Node.js 22 on UBI9
- **Server**: Express 4
- **PDF engine**: Puppeteer + puppeteer-cluster (headless Chromium)
- **Templates**: React 18 SSR with Scalprum module federation
- **Storage**: AWS S3 (MinIO for local dev)
- **Messaging**: KafkaJS (cross-pod status sync)
- **Styling**: PatternFly 5 + 6
- **Build**: Webpack
- **Test**: Jest with ts-jest
- **Lint**: ESLint
- **Metrics**: Prometheus via express-prom-bundle
- **Config**: Clowder via app-common-js

## Non-Negotiable Conventions

1. **Tests co-located** — `src/foo/bar.ts` → `src/foo/bar.spec.ts`. Always `.spec.ts` suffix.
2. **Use npm scripts** — `npm test`, `npm run lint`, `npm run build`. Never call CLI tools directly.
3. **Async/await** — always `await` async operations. Never fire-and-forget (e.g., `await pdfCache.verifyCollection()`).
4. **Error serialization** — use `JSON.stringify(errorString)` not `JSON.stringify(error)`. Error objects stringify to `"{}"`.
5. **No browser APIs in templates** — React components used for PDF rendering must be SSR-compatible. No `window`, `document`, `localStorage`.
6. **Config via abstraction** — use `config.ts` for all env vars and Clowder settings. Never read `process.env` directly in business logic.
7. **Identity flow** — auth data flows through `express-http-context`, not request parameters. The middleware extracts it; `clusterTask.ts` injects it into Puppeteer pages.
8. **Consistent error responses** — all API errors use `{ error: { status, statusText, description } }` format.
9. **No empty test scaffolding** — remove unused `beforeEach`/`afterEach` blocks.
10. **Circular dependency check** — run `npm run circular` before committing. The build enforces this.

## Common Pitfalls

1. **PdfCache state machine** — collections transition through `Generating → Generated/Failed`. `verifyCollection()` checks expected vs actual component count. Always await it before reading status.
2. **Puppeteer page lifecycle** — pages MUST be closed in `finally` blocks. Leaking pages exhausts the cluster's concurrency slots.
3. **Kafka consumer group** — each pod uses `pdf-gen-<hostname>` as its group ID. New consumers skip historical messages.
4. **Template error detection** — Puppeteer checks two DOM elements: `#crc-pdf-generator-err` (React app error) and `#report-error` (SSR rendering error). Both must be checked.
5. **Proxy initialization** — the assets proxy is lazily initialized on first request. `hasProxy` flag prevents duplicate registration.
6. **S3 upload failures** — caught and logged but don't crash the generation. The PDF may still be on local disk.
7. **v1 API deprecated** — `POST /v1/generate` returns 400. All new work should use v2 endpoints.
8. **Chrome path in production** — differs from development. `CHROMIUM_PATH` in `src/browser/helpers.ts` resolves it based on `IS_PRODUCTION`.

## Documentation Index

| File | Description |
|------|-------------|
| [docs/security-guidelines.md](docs/security-guidelines.md) | Auth flow, Puppeteer security, input sanitization, S3 credentials |
| [docs/testing-guidelines.md](docs/testing-guidelines.md) | Jest config, test patterns, mocking strategies, coverage |
| [docs/error-handling-guidelines.md](docs/error-handling-guidelines.md) | Error classes, PDF generation error flow, logging, status updates |
| [docs/integration-guidelines.md](docs/integration-guidelines.md) | Architecture, Scalprum, Puppeteer cluster, S3, Kafka, Docker, metrics |
| [docs/onboarding.md](docs/onboarding.md) | Service integration guide for PDF template consumers |
| [docs/API-integration.md](docs/API-integration.md) | API integration details |
| [docs/creating-api-requests.md](docs/creating-api-requests.md) | API request examples |
| [docs/pdf-template-development.md](docs/pdf-template-development.md) | Template development guide |
| [docs/local-development-setup.md](docs/local-development-setup.md) | Local dev environment setup |
| [docs/openapi.json](docs/openapi.json) | OpenAPI specification |
