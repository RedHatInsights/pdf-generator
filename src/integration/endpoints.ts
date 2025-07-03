import { Endpoint } from 'app-common-js';

export enum ServiceNames {
  'ros-backend' = 'ros-backend',
  'chrome-service' = 'chrome-service',
  'advisor-backend' = 'advisor-backend',
  'vulnerability-engine' = 'vulnerability-engine',
  'compliance-backend' = 'compliance-backend',
}

export type ServicesEndpoints = {
  [key in ServiceNames]: Endpoint;
};
