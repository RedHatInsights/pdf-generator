
## Service Integration and Onboarding

1. Ensure API data and networking is correctly setup
2. Develop your PDF template in your app's repo
3. Test your setup locally
4. Create a PDF API request for your application


### Ensure the pdf-generator can reach your API

Following the [API integration](./API-integration.md) guide, ensure that the network will allow traffic
between the generator and your API.


### Develop your PDF template

PDF templates will now live in the tenant application's repository. The template will be a React module
that will implement the `FetchData` method and expose itself as a federated module for use with Scalprum.
An example of a working entry [can be found in the landing-page-frontend repo.](https://github.com/RedHatInsights/landing-page-frontend/blob/master/src/moduleEntries/PdfEntry.tsx). 

For further details please read the in-depth [PDF Template development](./pdf-template-development.md) guide.

If you have an old template from the `v1` implementation, they are stored in an [older git reference and can be found here](https://github.com/RedHatInsights/pdf-generator/tree/636695be494f145f89f11264e6b7707f8077a443/src/templates).

### Test your setup locally

Follow the [Local development setup](./local-development-setup.md) guide and ensure your PDF template is working. You should replace 
the placeholder paths (`./src/path/to/file.tsx` ) with your newly created React module location.


### Create a PDF API request

Finally, following the [Creating PDF API request](./creating-api-requests.md) guide should allow you to generate a PDF from your template. 

Please note that your frontend will need to construct this payload PROGRAMMATICALLY. This data must be dynamic. The `crc-pdf-generator` api service
cannot know how metadata and pagination works for each tenant API so it has exposed a `fetchDataParams` object to allow for correct pagination based on
your API's specific implementation. Any API response with greater than 500 objects must be paginated. The browser cannot populate a Patternfly table with
thousands of objects. The default limit for most APIs is around 50-100. You can think of this step as pagination for the `crc-pdf-generator` api.


## Wrapping up

Please reach out to the `platform-experience-services` team when you have a working module and we will be happy to assist with any further questions 
or testing needs. Once these steps are implemented, your team is considered onboarded. 
