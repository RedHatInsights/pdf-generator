# crc-pdf-generator

`crc-pdf-generator` is a NodeJS based service that is responsible for generating a PDF Report.

For local development you can edit the passed data in the `src/index.js` file. Then to view the changes in real time
in the browser just do:
* `npm ci`
* `npm start:server`
This will start the react scripts and will serve just the react app on localhost:8000.

This development will not have the header, but the content of the page will be printed identically into the PDF
making this approach much faster to make changes to the PDF.

```sh
oc port-forward -n crc-pdf-generator svc/crc-pdf-generator-api 8000:8000
```
