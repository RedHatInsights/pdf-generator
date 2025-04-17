# Creating PDF API request

## Prerequisites

1. [API integration](./API-integration.md)
2. [Local development setup](./local-development-setup.md)
3. [PDF Template development](./pdf-template-development.md)

## Using Chrome UI API

The Chrome shell has exposed API that handles the API requests. The process of generating PDFs is tasked based and the initial request does not return the PDF itself, only the task ID. The Chroming API takes care of monitoring the tasks and downloading the PDF when its ready, or catching the error and reporting it.

### chrome.requestPdf

```js
const { requestPdf } = useChrome()

// at some point in code

// single PDF template
requestPdf({
  filename: 'chrome-api.pdf'
  payload: {
    manifestLocation: '/apps/landing/fed-mods.json',
    scope: 'landing',
    module: './PdfEntry'
  },
})

// split PDF tasks
requestPdf({
  filename: 'chrome-api.pdf'
  payload: [{
    manifestLocation: "/apps/landing/fed-mods.json",
    scope: "landing",
    module: "./IntroPage",
  }, {
    manifestLocation: "/apps/landing/fed-mods.json",
    scope: "landing",
    module: "./PdfEntry",
    // This object will make to the `fetchData` function as a second `options` argument
    fetchDataParams: {
      limit: 50,
      offset: 0
    }
  }, {
    manifestLocation: "/apps/landing/fed-mods.json",
    scope: "landing",
    module: "./PdfEntry",
    fetchDataParams: {
      limit: 50,
      offset: 50
    }
  }, {
    manifestLocation: "/apps/landing/fed-mods.json",
    scope: "landing",
    module: "./PdfEntry",
    fetchDataParams: {
      limit: 50,
      offset: 100
    }
  }, {
    manifestLocation: "/apps/landing/fed-mods.json",
    scope: "landing",
    module: "./PdfEntry",
    fetchDataParams: {
      limit: 50,
      offset: 150
    }
  }, {
    manifestLocation: "/apps/landing/fed-mods.json",
    scope: "landing",
    module: "./SummaryPage",
  }],
})
```

Once the PDF is generated, it will be automatically downloaded. If the process fails, an error is thrown and has to be handled by the code that initiated the request.

> NOTE: Integration with chrome notifications system will follow as soon as it is available.

### Additional Parameters
`staticData`: If you have data that cannot be imported directly into the template, you can pass it in to the template as a key value pair:

```TSX
requestPdf({
  filename: 'chrome-api.pdf'
  payload: {
    manifestLocation: "/apps/landing/fed-mods.json",
    scope: "landing",
    module: "./IntroPage",
    staticData: {
      renderPicture: true,
      supportCasesOpen: 20,
    }
  }
```
