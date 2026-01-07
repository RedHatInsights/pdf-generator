# crc-pdf-generator

`crc-pdf-generator` is a NodeJS based service that is responsible for generating a PDF Report.

For local development you need to create a default `.env` file with the following default credentials (not used in any other environment)

```
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"
MAX_CONCURRENCY=2
```

Then run

```
 npm ci
 docker-compose up
 npm run start:server
```
This will start the react scripts and will serve just the react app on localhost:8000.


This development will not have the header, but the content of the page will be printed identically into the PDF
making this approach much faster to make changes to the PDF.

```sh
oc port-forward -n crc-pdf-generator svc/crc-pdf-generator-api 8000:8000
```

## Service Integration and Onboarding

Follow [the onboarding guide](./docs/onboarding.md) to integrate your service with the CRC PDF generator


## Endpoints
You currently have 2 choices for generating any of the available templates:

### Production Endpoint
The generate endpoint will automatically download the template if it is available (requires the above-mentioned headers)
```
 POST http://localhost:8000/api/crc-pdf-generator/v2/create
```

The request body is an array of Scalprum configs

``` shell
"payload" : [
  {
    "manifestLocation": "/apps/landing/fed-mods.json",
    "scope": "landing",
    "module": "./PdfEntry"
  }
]


```

### For local development only
The preview endpoint will instead return the pdf preview environment:
```
 GET http://localhost:8000/preview
```
While this endpoint is currently only available for local testing, the preview environment will eventually be exposed in
production as well.


## Downloading a report in the browser

To download the report, you will need a small piece of JS code. Here is an example of downloading ROS executive report:

```js
// use fetch or XHR. 
fetch('/api/crc-pdf-generator/v2/create', {
  method: 'POST',
  headers: {
    // do not forget the content type header!
    'Content-Type': 'application/json',
  },

  body: JSON.stringify({
      "payload": [
        {
          "manifestLocation": "/apps/landing/fed-mods.json",
          "scope": "landing",
          "module": "./PdfEntry"
        },
        {
          "manifestLocation": "/apps/landing/fed-mods.json",
          "scope": "landing",
          "module": "./PdfEntry"
        }
	    ]
    }),
  })
  .then(async (response) => {
    const res = await response.json();
		console.log(res.statusID);
  });

```
Grab the statusID from the response and add it to the status call

``` js
fetch('/api/crc-pdf-generator/v2/status/19f76eab-e3c0-482e-8a66-f02fcb28057f', {
  headers: {
    // do not forget the content type header!
    'Content-Type': 'application/json',
  }
  
  })
  .then(async (response) => {
    const res = await response.json();
		console.log(res);
  })

```

Download the PDF

``` js
fetch('/api/crc-pdf-generator/v2/download/19f76eab-e3c0-482e-8a66-f02fcb28057f', {
  headers: {
    // do not forget the content type header!
    'Content-Type': 'application/json',
  }
  
  })
  .then(async (response) => {
    if (response.ok === false) {
      const res = await response.json()
      console.log(`PDF failed to generate: ${res.error.description}`)
      throw new Error(`PDF failed to generate: ${res.error.description}`)
    }
    return response.blob()
  })
  .then((blob) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // give name to the PDF file
    a.download = 'filename.pdf';
    document.body.appendChild(a); // we need to append the element to the dom -> otherwise it will not work in firefox
    a.click();
    a.remove(); //remove the element
  });

```
The PDF file will be downloaded in the browser.


