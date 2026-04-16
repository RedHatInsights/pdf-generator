# Error Handling Guidelines

## Custom Error Classes

All error classes are in `src/server/errors.ts`:

- `PdfGenerationError` — extends `Error`, includes `collectionId` and `componentId`. Used in `clusterTask.ts` when PDF generation fails. Captures stack trace.
- `PDFNotImplementedError` — code 404, for unimplemented templates.
- `PDFNotFoundError` — code 500, when a PDF file is missing from disk.
- `SendingFailedError` — code 500, when PDF response streaming fails.
- `PDFRequestError` — code 500, for data fetch errors.

Note: `PDFNotImplementedError`, `PDFNotFoundError`, `SendingFailedError`, and `PDFRequestError` do NOT extend `Error`. They are plain objects with `code` and `message` properties.

## PDF Generation Error Flow

The async pipeline has 3 failure detection points in `src/browser/clusterTask.ts`:

1. **DOM error elements** — after page load, checks for `#crc-pdf-generator-err` (React app error) and `#report-error` (template rendering error). If found, sets `PdfStatus.Failed` and calls `PdfCache.invalidateCollection()`.
2. **HTTP status check** — validates `pageResponse.status()` is 2xx or 3xx via `isValidPageResponse()`. Cache responses (3xx) are treated as valid.
3. **PDF print failure** — errors during `page.pdf()` or `store.uploadPDF()`.

All three paths: update status via `UpdateStatus()` → invalidate collection → throw `PdfGenerationError`.

## API Error Response Format

All error responses use a consistent structure:
```json
{
  "error": {
    "status": <number>,
    "statusText": "<short description>",
    "description": "<detailed message>"
  }
}
```

Status codes used:
- `202` — PDF generation queued (success)
- `400` — status/download lookup errors
- `404` — status ID not found, PDF not found
- `500` — internal errors, PDF generation failures

## Logging

- Winston with syslog levels (`src/common/logging.ts`). Level set via `LOG_LEVEL` env var (default: `debug`).
- Three logger instances:
  - `apiLogger` — server application logs
  - `hpmLogger` — HTTP Proxy Middleware logs (includes `splat` format)
  - `requestLogger` — Express request logs (structured JSON with timestamp)
- In non-verbose mode (level <= warning), successful 200 responses are skipped in request logs.
- Puppeteer console output is forwarded to `apiLogger.info()` with `[Headless log]` prefix.

## Status Updates via Kafka

- `UpdateStatus()` in `src/server/utils.ts` writes to both local `PdfCache` and Kafka topic.
- Kafka send failures are caught and logged but do not fail the request — the local cache still tracks status.
- Always await `pdfCache.verifyCollection()` before reading collection status (checks expected vs actual component count).

## Error Serialization

- Use `JSON.stringify(errorString)` for error messages, not `JSON.stringify(error)` — `Error` objects have non-enumerable properties that stringify to `"{}"`.
- Template rendering errors are embedded in HTML for Puppeteer to detect. Always JSON-stringify error content before embedding.
