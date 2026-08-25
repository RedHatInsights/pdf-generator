import { Endpoint } from 'app-common-js';

export enum ServiceNames {
  'ros-backend' = 'ros-backend',
  'chrome-service' = 'chrome-service',
  'advisor-backend' = 'advisor-backend',
  'vulnerability-engine' = 'vulnerability-engine',
  compliance = 'compliance',
  'ccx-smart-proxy' = 'ccx-smart-proxy',
  'content-sources-backend' = 'content-sources-backend',
}

export type ServicesEndpoints = {
  [key in ServiceNames]: Endpoint;
};

export type IntegrationEndpointsMap = Partial<
  Record<ServiceNames | `${ServiceNames}-${string}`, Endpoint>
>;
