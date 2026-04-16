# Testing Guidelines

## Framework

- **Jest** with `ts-jest` preset (`ts-jest/presets/js-with-ts`).
- Config: `jest.config.js`. Test timeout: 30 seconds.
- CSS/SCSS imports are mocked via `identity-obj-proxy`.
- `pdf-merger-js` is excluded from `transformIgnorePatterns` to enable ESM transform.

## Commands

- Run all tests: `npm test`
- Run specific test: `npm test -- --testPathPattern=<pattern>`
- Lint: `npm run lint`
- Lint with fixes: `npm run lint:fix`
- Circular dependency check: `npm run circular`

## Test File Location

- Tests are co-located with source files using the `.spec.ts` suffix.
- Existing test files:
  - `src/server/routes/routes.spec.ts` — route handler tests
  - `src/common/kafka.spec.ts` — Kafka client tests
  - `src/common/pdfCache.spec.ts` — PDF cache logic tests
  - `src/common/store/objectStore.impl.spec.ts` — S3 object store tests

## Mocking Patterns

- Use `jest.mock()` for module-level mocks. Common mocks include:
  - `puppeteer-cluster` — mock `Cluster.launch()` and the page object
  - `../common/config` — mock config values
  - `../common/kafka` — mock `produceMessage` to avoid real Kafka connections
  - `../common/store` — mock S3 upload/download
- The `jest.setup.ts` file runs before tests — sets `process.env.ACG_CONFIG = 'fixtures/stage.json'` to enable Clowder config loading in test mode.
- When mocking async functions, always use `jest.fn().mockResolvedValue()` or `jest.fn().mockRejectedValue()`.

## Writing New Tests

- Always co-locate tests next to the module: `src/foo/bar.ts` → `src/foo/bar.spec.ts`.
- Test both success and error paths. The PDF generation pipeline has many failure modes (page load errors, render errors, S3 upload failures, Kafka failures).
- For route handler tests, use supertest or mock `Request`/`Response` objects.
- Do not leave empty `afterEach` blocks — remove scaffolding.
- Use `JSON.stringify(errorString)` not `JSON.stringify(error)` when testing error serialization — `Error` objects have non-enumerable properties.

## Coverage

- No formal coverage threshold is configured.
- Key areas needing coverage: `clusterTask.ts` (PDF generation), `pdfCache.ts` (cache state machine), `routes.ts` (API endpoints), `kafka.ts` (message handling).
