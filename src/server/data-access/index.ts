import { AxiosRequestHeaders } from 'axios';
import { IncomingHttpHeaders } from 'http';
// import * as getAutomationAnalyticsDescriptor from './automation-analytics';
import prepareServiceCall, { ServiceCallFunction } from './call-service';
import demoDescriptor from './demoDescriptor';
import complianceDescriptor from './complianceDescriptor';
import vulnerabilityDescriptor from './vulnerabilityDescriptor';
import advisorDescriptor from './advisorDescriptor';
import ServiceNames from '../../common/service-names';
import templates from '../../templates';
import rosDescriptor from './rosDescriptor';

type TemplateAccessMapper<T> = {
  [Service in keyof T]: {
    [Accessor in keyof T[Service]]: ServiceCallFunction;
  };
};

const templateMapper: TemplateAccessMapper<typeof templates> = {
  // 'automation-analytics': prepareServiceCall(getAutomationAnalyticsDescriptor),
  [ServiceNames.demo]: {
    demo: prepareServiceCall(demoDescriptor.templates.demo),
  },
  [ServiceNames.compliance]: {
    report: prepareServiceCall(complianceDescriptor.templates.report),
  },
  [ServiceNames.vulnerability]: {
    vulnerabilities: prepareServiceCall(
      vulnerabilityDescriptor.templates.vulnerabilities
    ),
    systems: prepareServiceCall(vulnerabilityDescriptor.templates.systems),
    cve: prepareServiceCall(vulnerabilityDescriptor.templates.cve),
    executive: prepareServiceCall(vulnerabilityDescriptor.templates.executive),
  },
  [ServiceNames.advisor]: {
    advisor: prepareServiceCall(advisorDescriptor.templates.advisor),
  },
  [ServiceNames.ros]: {
    executiveReport: prepareServiceCall(
      rosDescriptor.templates.executiveReport
    ),
  },
};

async function getTemplateData(
  headers: IncomingHttpHeaders,
  templateConfig: {
    service: ServiceNames;
    template: string;
  },
  options?: Record<string, any>
): Promise<unknown> {
  const dataAccessor =
    templateMapper?.[templateConfig.service]?.[templateConfig.template];

  if (typeof dataAccessor === 'function') {
    const data = await dataAccessor(
      headers as AxiosRequestHeaders,
      options as Record<string, any>
    );
    return data;
  } else {
    throw new Error(
      `No API descriptor avaiable for ${templateConfig.service}: ${templateConfig.template}!`
    );
  }
}

export default getTemplateData;
