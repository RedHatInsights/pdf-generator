# Service integration

To integrate your service into the PDF generator follow these steps:

1. [Enable crc-pdf-generator as a dependency](#clowder-conf)
2. [Make sure you have endpoints exposing required data](#check-endpoints)
3. [Create an API descriptor to get your data](#create-descriptor)
4. [Create a JSX template to render your PDF](#create-template)
5. [Verify your integration in ephemeral environment](#ephemeral-env)

## <a name="clowder-conf"></a>Enable crc-pdf-generator as a dependency

To enable the PDF generator service to connect to your service API, a network policy has to be set up to allow communication between the cluster namespaces.

1. Add the PDF generator as a `optionalDependency` in PDF generator clowder config [Example](https://github.com/RedHatInsights/pdf-generator/blob/main/deploy/clowdapp.yml#L12). Without this setting, the PDF generator will not know the location of your service.
3. Add PDF generator to `networkPoliciesAllow` in your service namespace config. [Example](https://gitlab.cee.redhat.com/service/app-interface/-/merge_requests/46592/diffs) Without this setting, the PDF generator won't be allowed to communicate with your service.

## <a name="check-endpoints"></a>Make sure you have endpoints exposing the required data

To render the PDF report, the report requires data. Make sure your service is exposing the necessary endpoint(s). In an ideal scenario, only one API call would be required to request all data.

## <a name="create-template"></a>Create a JSX template to render your PDF

The next step is to add the JSX template to render the PDF on the server. To create a template follow these steps

1. Create a new directory in `src/templates/<service-name>`.
2. Inside the directory create a template body. Any valid react component following the Patternfly guidelines design is a valid template.
3. (optional) If necessary, create a header and footer component. We string recommend using **default header and footer**.
4. Add a new ID for your service into the `src/common/service-names.ts` enum. Don't forget to give it explicit name!
5. Register your template in `src/templates/index.ts`. Put your template into a matching service object. If your service is not listed inside the object, create a new entry and add your service name to the `src/common/service-names.ts` enum. Make sure to assign header and footer components of your liking.

This is how the templates folder should look like after your files are created

```sh
├── service-name
│   ├── ... any composite files/directories
│   └── TemplateComponent.tsx
... rest of the directory
```

This is how the `src/common/service-names.ts` changes should look like when adding new service:

```diff
diff --git a/src/common/service-names.ts b/src/common/service-names.ts
index d675af2..25dce6a 100644
--- a/src/common/service-names.ts
+++ b/src/common/service-names.ts
@@ -4,6 +4,7 @@ enum ServiceNames {
   'vulnerability' = 'vulnerability',
   'advisor' = 'advisor',
   'ros' = 'ros',
+  'service-name' = 'service-name',
 }
 
 export default ServiceNames;

```

This is how the `src/templates/index.ts` changes should look like with a new service registered:

```diff
diff --git a/src/templates/index.ts b/src/templates/index.ts
index a5ebb7f..2a473ca 100644
--- a/src/templates/index.ts
+++ b/src/templates/index.ts
@@ -10,6 +10,7 @@ import ComplianceTemplate from './compliance/template';
 import RosExecutiveTemplate from './ros/executive-report';
 import CveReport from './vulnerability/cve-report/Template';
 import CveFooter from './vulnerability/cve-report/CveFooter';
+import TemplateComponent from './service-name/TemplateComponent';
 
 export type TemplateElement = (props: any) => JSX.Element;
 
@@ -92,6 +93,13 @@ const templates: TemplateMapper = {
       footer: CommonFooter,
     },
   },
+  [ServiceNames['service-name']]: {
+    reportName: {
+      template: TemplateComponent,
+      header: CommonHeader,
+      footer: CommonFooter.
+    }
+  }
 };
 
 export default templates;

```

## <a name="create-descriptor"></a>Create an API descriptor to get your data

To request the service data, the PDF service requires an API descriptor.

The API descriptor:

- Requests data while the generator is deployed in production, stage, and ephemeral environments.
- Replaces API call with the mocked request in a local and test environment
- Allows definition of customized data requests

To create a descriptor follow these steps:

1. Create a new directory in `src/server/data-access/<descriptor-name>`. Note: one descriptor can handle requests for multiple templates.
2. Add a TS file that exports mocked data to the new directory. This file will be used for testing and local development.
3. Add a descriptor TS file. This file has to export the following object:


```sh
src
├── browser
├── common
├── middleware
├── server
│   ├── data-access
│   │   ├── ... existing descriptors
│   │   └── descriptor-name # new descriptor

```

The descriptor file has to export a constant of the following type:

```TS
export type APIDescriptor<T = any, R = unknown> = {
 // the service name
 service: ServiceNames;
 // for a simple request
 path?: string;
 // if a simple get request is used, mutate the data in this function
 responseProcessor?: (...args: any[]) => R;
 // a function that returns the mocked data
 mock: (...args: any[]) => Promise<T>;
 /**
  * @description Fully customized request
  * @param {AxiosRequestHeaders} headers Headers are identical to the headers received by the PDF service. Include the x-rh-identity object
  * @param {Record<string, any>} options A request body passed to the original generate request. Used to configure the request.
  * @returns {Promise<any>}
  */
 request?: (
   headers: AxiosRequestHeaders,
   options: Record<string, any>
 ) => Promise<R>;
};


export type ServiceDescriptor = {
 // Each template of a service request its own descriptor
 templates: {
   [key: string]: APIDescriptor;
 };
};
```

A final descriptor can look like this:

```TS
import { ServiceCallFunction, ServiceDescriptor } from '../call-service';
import ServiceNames from '../../../common/service-names';
import config from '../../../common/config';
import axios, { AxiosRequestHeaders } from 'axios';

const BASE_URL = `http://${config?.endpoints['service-name']?.hostname}:${config?.endpoints['service-name']?.port}/api/foo/v1`;
const TEMPLATE_DATA_URL = `${BASE_URL}/template-data-endpoint`;

// data for testing and local development
const getMock: ServiceCallFunction = () => {
  return Promise.resolve({
    // depends on your template needs
    foo: {
      bar: {
        baz: 'quazz'
      }
    }
  })
}

async function getData(headers: AxiosRequestHeaders) {
  const data = await axios.get(TEMPLATE_DATA_URL, {
    headers
  })

  return data
}

const responseProcessor = (data) => {
  // mutate the data if required
  return data
}

const serviceDescriptor: ServiceDescriptor = {
 templates: {
   reportName: {
     service: ServiceNames['service-name'], // service name
     responseProcessor, // response processor will be used for mocked data processing
     request: getData, // deployed request
     mock: getMock, // function that returns mocked data in local or test
   },
  //  other templates
 },
};

export default serviceDescriptor;
```

### Figuring out the request URL

Sometimes composing the descriptore URLs can be a bit tricky. The PDF generator retrieves the hostname and port from a clowder config.

This data will be only accessible if we add the service to [`optionalDependecies` inside the clowder config](#clowder-conf). Sometimes the official service name and deployed sername names might not match.

This is the reson why **every service** has to be mapped to its endpoint.

To do that, follow these steps:

1. Open `src/server/data-access/callservice.ts` file.
2. Find the `getServiceEndpointMap` endpoint map.
3. Add a new entry to the map.

```diff
diff --git a/src/server/data-access/call-service.ts b/src/server/data-access/call-service.ts
index 6353293..d14a58d 100644
--- a/src/server/data-access/call-service.ts
+++ b/src/server/data-access/call-service.ts
@@ -35,6 +35,7 @@ const getServiceEndpointMap = (
     [ServiceNames.demo]: ServiceNames.demo,
     [ServiceNames.ros]: 'ros-backend',
     [ServiceNames.vulnerability]: 'vulnerability-engine-manager-service',
+    [ServiceNames.someService]: 'the-api-endpoint-name',
   };
   return services[service] as unknown as keyof ServicesEndpoints;
 };

```

Most of service names do not match the actual endpoint names. If you don't know what value should be added, we suggest consulting the responsible backend team to provide you with the details. The endpoints data is retrieved from `clowder.LoadedConfig.endpoints`. The config file can also be inspected in stage or ephemeral enviroment in the openshift terminal.

Once the service and endpoints are correctly mapped, you can compose the URL in your service descriptor from exposed config:
```TS
// config file is located at src/common/config.ts
import config from '../../../common/config';

const BASE_URL = `http://${config.endpoints.serviceName?.hostname}:${config.endpoints.serviceName?.port}/api/...`

// http://servicenamehostname:9999/api/...
```

Hostnames and ports are dynamic. Do not try using static values. Eventually the data will change and your API descriptor will stop working.

## Register service descriptor

Once your descriptor is finalized and you have a correct URL, you can finally register your service. To do that open the `src/server/data-access/index.ts` dile and add your descriptor to the `templateMapper` object. The changes might look similar to this:

```diff
diff --git a/src/server/data-access/index.ts b/src/server/data-access/index.ts
index 52ac9f5..f122fe3 100644
--- a/src/server/data-access/index.ts
+++ b/src/server/data-access/index.ts
@@ -9,6 +9,7 @@ import advisorDescriptor from './advisorDescriptor';
 import ServiceNames from '../../common/service-names';
 import templates from '../../templates';
 import rosDescriptor from './rosDescriptor';
+import serviceDescriptor from './serviceDescriptor';
 
 type TemplateAccessMapper<T> = {
   [Service in keyof T]: {
@@ -40,6 +41,9 @@ const templateMapper: TemplateAccessMapper<typeof templates> = {
       rosDescriptor.templates.executiveReport
     ),
   },
+  [ServiceNames.someService]: {
+    reportName: prepareServiceCall(serviceDescriptor.templates.reportName)
+  },
 };
 
 async function getTemplateData(

```

## Verifying integration

Before a PR is submitted, it will be required to verify the integration inside ephemenral environment. If you are not familiar with EE, we recommend reading the [documentation](https://consoledot.pages.redhat.com/docs/dev/getting-started/ephemeral/index.html).

### Quick tips

#### Testing PDF generator API descriptor changes

We recommend building a PDF generator quay image locally and push to your quay repository and in the global bonfire config set the image tag. This way an ephemeral environment 2ill be initialized with your local changes.

You can build, tag, and push local images using the following commands:

```sh
docker build . -t quay.io/mmarosi/crc-pdf-test
docker push quay.io/mmarosi/crc-pdf-test

NAMESPACE=$(bonfire deploy crc-pdf-generator)
```

You can download the PDF from the EE OpenShift terminal using the following command. Just make sure to get some valid token for the `x-rh-identity` header. You can simply use the same token you receive from SSO on the staging environment. Or create a fake token. You can get the host and port from your EE. Make sure to add the `-m 15` (or larger number) to prevent the request from timing out if your data collection takes longer.
```sh
curl --location --request POST 'http://crc-pdf-generator-api.ephemeral-xrfidx.svc:8000/api/crc-pdf-generator/v1/generate' \
--header 'x-rh-identity: TOKEN' \
--header 'Content-Type: application/json' \
--data-raw '{
    "service": "vulnerability",
    "template": "cve"
}' \
-m 15
```
