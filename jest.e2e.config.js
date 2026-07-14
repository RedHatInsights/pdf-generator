const { defaults: tsjPreset } = require('ts-jest/presets');

module.exports = {
  displayName: 'e2e',
  preset: 'ts-jest/presets/js-with-ts',
  testTimeout: 60000,
  testMatch: ['**/*.e2e.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  transformIgnorePatterns: [
    'node_modules/(?!(puppeteer|puppeteer-core|@puppeteer/browsers|chromium-bidi|pdf-merger-js)/)',
  ],
  transform: {
    ...tsjPreset.transform,
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
  maxWorkers: 1,
};
