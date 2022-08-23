import { AxiosRequestConfig, AxiosRequestHeaders } from 'axios';
import { IncomingHttpHeaders } from 'http';
// import * as getAutomationAnalyticsDescriptor from './automation-analytics';
import prepareServiceCall, { ServiceCallFunction } from './call-service';
import demoDescriptor from './demoDescriptor';
import complianceDescriptor from './complianceDescriptor';
import vulnerabilityDescriptor from './vulnerabilityDescriptor';
import advisorDescriptor from './advisorDescriptor';
import vulnerabilitiesSystemDescriptor from './vulnerabilitiesSystemDescriptor';
import ServiceNames from './service-names';

const templateMapper: {
  [key in ServiceNames]: ServiceCallFunction;
} = {
  // 'automation-analytics': prepareServiceCall(getAutomationAnalyticsDescriptor),
  [ServiceNames.demo]: prepareServiceCall(demoDescriptor),
  [ServiceNames.compliance]: prepareServiceCall(complianceDescriptor),
  [ServiceNames.vulnerability]: prepareServiceCall(vulnerabilityDescriptor),
  [ServiceNames.advisor]: prepareServiceCall(advisorDescriptor),
  [ServiceNames.vulnerabilitiesSystem]: prepareServiceCall(
    vulnerabilitiesSystemDescriptor
  ),
};

async function getTemplateData(
  headers: IncomingHttpHeaders,
  template: ServiceNames,
  options?: Omit<AxiosRequestConfig, 'headers'>
): Promise<unknown> {
  const dataAccessor = templateMapper[template];

  if (typeof dataAccessor === 'function') {
    const data = await dataAccessor(headers as AxiosRequestHeaders, {
      ...options,
      method: template === ServiceNames.compliance ? 'POST' : 'GET',
      data:
        template === ServiceNames.compliance
          ? JSON.parse(
              '{"operationName":"getSystems","variables":{"perPage":50,"page":1,"filter":"policy_id = 2cf054d1-60d6-4f02-9bf4-ea25cac0d98b","policyId":"2cf054d1-60d6-4f02-9bf4-ea25cac0d98b"},"query":"query getSystems($filter: String!, $policyId: ID, $perPage: Int, $page: Int, $sortBy: [String!], $tags: [String!]) {\\n  systems(\\n    search: $filter\\n    limit: $perPage\\n    offset: $page\\n    sortBy: $sortBy\\n    tags: $tags\\n  ) {\\n    totalCount\\n    edges {\\n      node {\\n        id\\n        name\\n        osMajorVersion\\n        osMinorVersion\\n        insightsId\\n        testResultProfiles(policyId: $policyId) {\\n          lastScanned\\n          compliant\\n          score\\n          supported\\n          ssgVersion\\n          rulesFailed\\n          __typename\\n        }\\n        __typename\\n      }\\n      __typename\\n    }\\n    __typename\\n  }\\n}\\n"}'
            )
          : undefined,
    });
    return data;
  } else {
    throw new Error(`No API descriptor avaiable for ${template}!`);
  }
}

export default getTemplateData;
