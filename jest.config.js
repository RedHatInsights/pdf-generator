const { defaults: tsjPreset } = require('ts-jest/presets');

module.exports = {
  displayName: 'pdf-generator',
  preset: 'ts-jest/presets/js-with-ts',
  bail: 0,
  testTimeout: 30000,
  moduleNameMapper: {
    '\\.(css|scss)$': 'identity-obj-proxy',
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transform: {
    ...tsjPreset.transform,
    '^.+\\.mjs$': ['ts-jest', { isolatedModules: true }],
  },
  transformIgnorePatterns: [
    '(?<!http-proxy-middleware/)node_modules/(?!(pdf-merger-js|http-proxy-middleware|httpxy)/)',
  ],
  testMatch: ['./**/*.spec.ts'],
};
