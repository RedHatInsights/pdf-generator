# Local development setup

## Prerequisites

[**All used APIs were integrated with PDF generator**](./API-integration.md)

- node 18 or greater installed
- `npm` cli installed
- etc hosts patched (same requirement as for any HCC local UI development)
- docker-compose or podman-compose CLI installed 

## API proxy setup
### API Host

IF you wish to test some changes, you can manually set the API proxies and its target.

For example, if you would like to use the stage API, set the `API_HOST` env variable to stage and start the PDF generator development server:

```shell
API_HOST=https://console.redhat.com npm run start:server
```

This will redirect any API requests to the stage directly, and will use your browser auth headers. You can also point the proxy to your local API.

## Assets setup

Because the PDF templates embedded into UI repositories, a UI needs to be run locally and some proxy setup needs to be done.

### Module federation setup.

> The following uses the landing page frontend as an example

**Make sure your PDF template is exposed via module federation**

1. Create a new JS/TSX file in your repository.
2. Make sure the new file has a React component as a default export.
3. Make sure the new file has a named export called `fetchData`. Read more about [data fetching](./pdf-template-development.md#data-fetching).
4. in your `fec.config.js` add a new entry to the `moduleFederation.exposes` configuration. Choose a fitting name as a key and path to the created file as a value.

```js
// fec.config.js
const path = require('path')

module.exports = {
  // rest of configuration
  moduleFederation: {
    exposes: {
      './NewPdfTemplate': path.resolve(__dirname, './src/path/to/file.tsx')
    }
  }
}
```

**This is the first exposed module in module federation config!**

If your project does not have the `moduleFederation` already, it means it is using a default fallback. Make sure to also expose your application root! Otherwise chrome will don't have a reference to your application entry.

If your project is using the fallback, the application entry should be:

```js
'./RootApp': path.resolve(__dirname, './src/AppEntry')
```

Then config should look like this:

```js
// fec.config.js
const path = require('path')

module.exports = {
  // rest of configuration
  moduleFederation: {
    exposes: {
      './RootApp': path.resolve(__dirname, './src/AppEntry'),
      './NewPdfTemplate': path.resolve(__dirname, './src/path/to/file.tsx')
    }
  }
}
```

### Asset proxy setup.

This section has two configurations:

1. Instruct the locally running PDF generator to consume your local PDF template assets.
2. Instruct your frontend dev environment to use locally running PDF generator.

#### PDF generator setup

Use the `ASSETS_HOST` env variable to point PDF generator to FEC dev proxy:

```shell
ASSETS_HOST=https://localhost:1337 npm run start:server
```

#### Frontend dev environment proxy setup

In your `fec.config.js` setup a proxy for the PDF generator:

```js
// fec.config.js

module.exports = {
  // rest of the config
  routes: {
    '/api/crc-pdf-generator': {
      host: 'http://localhost:8000',
    }
  }
}

```

## Starting the PDF generator development service

### Prerequisites

Necessary [proxy-setup](#api-proxy-setup) finished.

### Running the PDF generator server

1. Start the kafka container with `docker-compose up`
2. Once the kafka container is initialized and running star the node server with assets and api proxies (your env values might be different):
```shell
# in the crc-pdf-generator repository root
ASSETS_HOST=https://localhost:1337 API_HOST=https://console.stage.redhat.com npm run start:server
```

## Starting the UI development environment

Necessary [proxy-setup](#api-proxy-setup) finished.

### Running the UI dev server

Use the usually development scripts for your application. The default command:

```shell
# in the UI repository root
npm run start
```

## Next steps

Learn more about [PDF Template development](./pdf-template-development.md).
