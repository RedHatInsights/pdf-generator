# crc-pdf-generator

`crc-pdf-generator` is a NodeJS based service that is responsible for generating a PDF Report.

For local development you can edit the passed data in the `src/index.js` file. Then to view the changes in real time
in the browser just do:
```
 npm ci
 npm run start:server
```
This will start the react scripts and will serve just the react app on localhost:8000.


This development will not have the header, but the content of the page will be printed identically into the PDF
making this approach much faster to make changes to the PDF.

```sh
oc port-forward -n crc-pdf-generator svc/crc-pdf-generator-api 8000:8000
```

## Service Integration

Please follow the [Integration guide](./INTEGRATION.md). 

## Endpoints
You currently have 2 choices for generating any of the available templates:

### Production Endpoint
The generate endpoint will automatically download the template if it is available (requires the above-mentioned headers)
```
 POST http://localhost:8000/api/crc-pdf-generator/v1/generate
```

The request body:

```TS
type RequestBody = {
  service: string; // service name
  template: string; // template name
  [key: string]: any // additional API request config attributes
}
```

### For local development only
The preview endpoint will instead return the pdf preview environment:
```
 GET http://localhost:8000/preview
```
While this endpoint is currently only available for local testing, the preview environment will eventually be exposed in
production as well.

### Endpoint Options
```
 `?template=x // See service-names for available templates. Required unless you want a hello world.` 
 `?orientation= landscape // optional`
```

## Downloading a report in the browser

To download the report, you will need a small piece of JS code. Here is an example of downloading ROS executive report:

```js
// use fetch or XHR. 
fetch('/api/crc-pdf-generator/v1/generate', {
  method: 'POST',
  headers: {
    // do not forget the content type header!
    'Content-Type': 'application/json',
  },

  body: JSON.stringify({
      // service and template params are mandatory
      service: 'ros',
      template: 'executiveReport',
      // ... any other config options accepted by your template
    }),
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
