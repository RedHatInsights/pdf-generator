# crc-pdf-generator

`crc-pdf-generator` is a NodeJS based service that is responsible for generating a PDF Report.

For local development you can edit the passed data in the `src/index.js` file. Then to view the changes in real time
in the browser just do:
```
 npm ci
 npm start:server
```
This will start the react scripts and will serve just the react app on localhost:8000.


This development will not have the header, but the content of the page will be printed identically into the PDF
making this approach much faster to make changes to the PDF.

```sh
oc port-forward -n crc-pdf-generator svc/crc-pdf-generator-api 8000:8000
```

# Endpoints
You currently have 2 choices for generating any of the available templates:

#### Production Endpoint
The generate endpoint will automatically download the template if it is available (requires the above mentioned headers)
```
 POST http://localhost:8000/api/crc-pdf-generator/v1/generate
```

#### For local development only
The preview endpoint will instead return the pdf preview environment:
```
 GET http://localhost:8000/preview
```
While this endpoint is currently only available for local testing, the preview environment will eventually be exposed in
production as well.

#### Endpoint Options
```
 `?template=x // See service-names for available templates. Required unless you want a hello world.` 
 `?orientation= landscape // optional`
```

# Templates and their Data
`crc-pdf-generator` produces PDF Reports based on individual templates.

These templates are styled utilizing `Patternfly` components and it's individual styling utility classes.

Each of these templates are fed data (currently) through `DataDescriptors`, with a descriptor prepared for each individual
template. 

For more details on these elements , feel free to explore the different descriptors and templates already present
in their underlying folders.

# Developing your own Templates (on this alpha version)
In order to have your own templates be generated through the service, please keep the following in mind:
```
* `Add the service name to the service-names.js file`
* `Following the structure of the demo descriptor (or any other) create a new data-descriptor file for your respective
and put it in it's own folder within the data-access directory`
* `In the call-service.ts file found in the same directory, add your new service-name to the AVAILABLE_SERVICES object,
following the examples found there`
* `Finally, create your React component within the templates directory and build your pdf template to be printed :)`
```

