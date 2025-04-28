# PDF Template development

## Prerequisites

[**All used APIs were integrated with PDF generator**](./API-integration.md)

[**Local development setup**](local-development-setup.md)

## Data fetching

Because the API works differently inside OpenShift cluster, the data fetching for the PDF templates is slightly abnormal compared to usual frontend development.

### Fetching data from within components

This is forbidden. the PDF generator can't reliably intercept and adjust according to the internal cluster network requirements. Any async requests made from the components are not supported and we do not guarantee he success of such requests.

### Fetching data from external API

Currently, only fetching data from the HCC internal OpenShift cluster is supported (APIs only hosted at console.redhat.com or it stage equivalent.).

Support for external APIs will follow.

### Defining async requests

The following types are included in the [frontend-components/types](https://github.com/RedHatInsights/frontend-components/tree/master/packages/types) package.
Import them and implement your requests as needed for your API. You can find a working example in the [Landing page's PDF module](https://github.com/RedHatInsights/landing-page-frontend/blob/master/src/moduleEntries/PdfEntry.tsx)

In the exposed PDF module define and export `fetchData` function. The name must match to correctly implement the interface.

```ts

import { AsyncState, CreateAxiosRequest, FetchData } from '@redhat-cloud-services/types';

export const fetchData: FetchData = async (createAsyncRequest: CreateAxiosRequest) => {
  // async implementation
};

```

*service*

Name of the API service. For example `chrome-service` or `ros-backend`. The service names are matching the clowder names.

This argument is used to determine what service should be used within the cluster.

*config*

The configuration of your service. It uses the axios (v1) configuration object. The `method` and `url` attributes are mandatory. The `url` has to be just a `pathname` **without a host**!

```js
  const requestWithAuth = createAsyncRequest('chrome-service', {
    method: 'GET',
    url: '/api/chrome-service/v1/user',
  });
```

#### Sample fetch data implementation

There can be asy many calls required in any order required. The PDF generator will use the return value as an input for the PDF template.

```ts
import {
  AsyncState,
  CreateAxiosRequest,
  FetchData,
} from '@redhat-cloud-services/types';

export const fetchData: FetchData = async (createAsyncRequest: CreateAsyncRequest) => {
  const requestGenerated = createAsyncRequest('chrome-service', {
    method: 'GET',
    url: '/api/chrome-service/v1/static/beta/stage/services/services-generated.json',
  });
  const requestStatic = createAsyncRequest('chrome-service', {
    method: 'GET',
    url: '/api/chrome-service/v1/static/beta/stage/services/services.json',
  });

  const requestWithAuth = createAsyncRequest('chrome-service', {
    method: 'GET',
    url: '/api/chrome-service/v1/user',
  });

  const data = await Promise.all([
    requestGenerated,
    requestStatic,
    requestWithAuth,
  ]);
  return data;
};

```

### Unwrapping the AxiosResponse

By default axios wraps any returned payload to object

```js
const response = {
  data: {
    // actual API response
  }
}
```

This means that by default data has to be accessed as response.data.

The `createAsyncRequest` **unwraps the response object**! Only the actual API response object is resolved by the returned promise.

### Splitting API requests

> NOTE: This part is critical to prevent the service crashes due to lack of resources. PDF generation is vert resource intensive and scales exponentially with the number of pages!

The `fetchData` function receives a `options` object as a second argument. This argument is used to re-use the same template with different inputs.

For example, if a table with 1000 entries is supposed to be rendered, it is recommended to split the PDF rendering into multiple tasks. Somewhere between 5 - 10 in this case. The number of tasks depends entirely on the visual complexity of the PDF.

```ts
type FetchData = (
  createAsyncRequest: CreateAxiosRequest,
  options: Record<string, any>
) => Promise<any>;
```

> NOTE the docs skips ahead in the following section, but it is critical the PDF splitting is understood. Some interaction with the API is explained later.

#### Splitting one PDF into multiple tasks

To prevent resource issues, PDF generator can split a generating task, run them in sequence, and then merge individual PDFs into a single document.

This way we can limit the complexity and resource usage and deliver the best result. However, the splitting hsa to be configured by the developers integrating with PDF generator. Each PDF is different, each API is different. Offloading the responsibility to template developers is critical to provide generic solution that can cover most use cases without the necessity of changing the data source (service API).

To leverage PDF splitting, request the PDF generator to generate multiple PDFs (using the same or different PDF template) and customize the data fetching inputs.

The example below has a sample payload. It has a separate template for initial PDF page, summary PDF page, and it re-uses a single template to "paginate" templates tat require large sum of data. It reflects for example paginated tabular. 

```js
// request payload:

const body = {
  // each entry in the array is one PDF task
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
  }]
}
```

The `fetchData` function for the `./PdfEntry` then can consume the parameters accordingly:

```ts
export const fetchData: FetchData = async (createAsyncRequest, options) => {
  const paginatedData = await createAsyncRequest('chrome-service', {
    method: 'GET',
    url: '/api/chrome-service/v1/fake-tabular-data',
    params: {
      // set pagination query params to the request
      limit: options.limit,
      offset: options.offset,
    },
  });

  return paginatedData
};
```

The template itself will then only receive the **paginated** data. Some unusual values (offset 54) might be required to achieve the best visual results. Nevertheless, it should be possible to programmatically generate such splitting based on the number entries in the response for example.

### What if large PDFs are not split?

If a large PDFs are not split, the service will be degraded. Any requests that will bring down the PDF service will be disabled and prohibited from integrating until the scaling issues are resolved (PDFs generation tasks are split into multiple).

## PDF Template layout

The templates for the PDF are simple React components. Why we use React and not plain HTML/CSS with some templating system such as Mustache?

The limitation is the design system which does not provide HTML/CSS binding for some components (primarily charts). This means using React for the PDF generation is the only option.

### Preparing template

In the exposed PDF module define and add a React component as a default export:

```TSX
const PDFTemplate = () => {
  return (
    <div>
      ...
    </div>
  )
}

export default PDFTemplate;

```

Don't forget to expose the template in your module federation settings. Read more in the [**Local development setup**](local-development-setup.md).

The template receives a prop which **contains the data from your `fetchData` export**!

```TSX
const PDFTemplate = ({ asyncData }) => {
  const { data } = asyncData
  return (
    <div>
      {/** use the data */}
      {data.map((entry) => ...)}
    </div>
  )
}

export default PDFTemplate;

```

The component will not render until the fetch promise is resolved. No need to handle loading or error states.

If the promise or the component rendering fails, the whole PDF generation process fails.

Feel free to add any static elements to the template to comply with the requirements. Any valid React component is accepted. CSS is supported and properly scoped.

Only restriction is the usage of data fetching from inside the PDF template.

### Additional Data

If your template requires additional data, you can either:
- Import the object into the template file.
- Pass it through the requestPDF function with the `additionalData` prop.

```TSX
const PDFTemplate = ({ asyncData, additionalData }) => {
  const { data } = asyncData
  const { additionalData } = additionalData
  return (
    <div>
      {/** use the data */}
      {data.map((entry) => ...)}
      {additionalData}
    </div>
  )
}

export default PDFTemplate;

```