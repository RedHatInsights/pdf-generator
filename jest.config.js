const { defaults: tsjPreset } = require('ts-jest/presets');

module.exports = {
  displayName: 'unit-test',
  preset: 'ts-jest/presets/js-with-ts',
  bail: 0,
  testTimeout: 30000,
  moduleNameMapper: {
    '\\.(css|scss)$': 'identity-obj-proxy',
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transform: {
    ...tsjPreset.transform,
  },
  transformIgnorePatterns: ['node_modules/(?!(pdf-merger-js)/)'],
  testMatch: ['./**/*.spec.ts'],
};
