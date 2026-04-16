# Security Guidelines

## Authentication Flow

- The `x-rh-identity` header carries a base64-encoded JSON identity object. The `identityMiddleware` (`src/middleware/identity-middleware.ts`) decodes it and stores user context via `express-http-context`.
- The middleware applies only to `POST /api/crc-pdf-generator/v2/create` and `GET /preview`. Other routes (status, download, healthz) are unauthenticated.
- The `cs_jwt` cookie and `Authorization` header are also extracted by the identity middleware and forwarded to Puppeteer pages via `page.setCookie()` and `page.setExtraHTTPHeaders()`.
- Never log or expose the raw `x-rh-identity`, `Authorization`, or `cs_jwt` values in error responses.

## Puppeteer Security

- Puppeteer runs with `--no-sandbox` because the container runs as a non-root user in OpenShift. This is intentional and documented in `src/server/cluster.ts`.
- Additional Chrome flags: `--disable-gpu`, `--no-zygote`, `--disable-dev-shm-usage`, `--proxy-server='direct://'`, `--proxy-bypass-list=*`.
- The proxy bypass flags prevent Puppeteer from making outbound network requests except through the configured proxy middleware. Pages are loaded via `localhost`.
- Browser timeout is 60 seconds (`BROWSER_TIMEOUT` constant), matching the gateway timeout.

## Input Sanitization

- `sanitizeString()` in `src/server/utils.ts` strips `<script>` tags from string values using a regex.
- `sanitizeRecord()` applies `sanitizeString()` to all values in a key-value record.
- Template rendering errors are embedded in HTML (`<div id="report-error">`). The error message is JSON-stringified before embedding to prevent injection.
- The `sanitize-html` package is listed as a dependency but is not currently imported in any TypeScript source files. Do not rely on it for sanitization — use `sanitizeString()` / `sanitizeRecord()` from `utils.ts`.

## S3 / Object Store

- Credentials (`MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`) come from environment variables or Clowder config.
- Never hardcode credentials. The default `.env` values (`minioadmin`) are for local development only.
- Bucket name is `crc-generated-pdfs`. PDFs are stored with UUID-based keys.
- In production, Clowder provides the S3 config including TLS settings.

## Proxy Security

- The assets proxy (`/apps/*`) strips the `Authorization` header before forwarding to prevent credential leakage.
- The API proxy (non-production only) forwards the auth header but logs `THIS SHOULD NOT BE HERE` — this proxy should never activate in production.
- Verify `config.IS_PRODUCTION` guards before adding any proxy middleware.

## Environment Variables

- Sensitive: `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MOCK_TOKEN`, Kafka SASL credentials.
- Never read or log these values. Use `config.ts` abstractions.
- `MOCK_TOKEN` is a fallback auth header used in development when no real token is available. It must never be set in production.
