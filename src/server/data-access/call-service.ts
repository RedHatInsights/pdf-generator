import axios, { AxiosRequestHeaders, AxiosRequestConfig } from 'axios';
import ServiceNames from '../../common/service-names';
import config, { ServicesEndpoints } from '../../common/config';

export type APIDescriptor<T = any, R = unknown> = {
  service: ServiceNames;
  path?: string;
  responseProcessor: (...args: any[]) => R;
  mock: (...args: any[]) => Promise<T>;
  request?: (
    headers: AxiosRequestHeaders,
    options: Record<string, any> // { policyId: string, totalHostCount: number }// Record<string, any> // Shape is completely off, but is it always the same?
  ) => Promise<R>;
};

export type ServiceDescriptor = {
  templates: {
    [key: string]: APIDescriptor;
  };
};

export type ServiceCallFunction = (
  headers: AxiosRequestHeaders,
  options: Omit<AxiosRequestConfig, 'headers'>
) => Promise<unknown>;

const getServiceEndpointMap = (
  service: ServiceNames
): keyof ServicesEndpoints => {
  const services = {
    [ServiceNames.compliance]: ServiceNames.compliance,
    // advisor does not have matching names
    [ServiceNames.advisor]: 'advisor-backend',
    [ServiceNames.vulnerability]: ServiceNames.vulnerability,
    [ServiceNames.demo]: ServiceNames.demo,
    [ServiceNames.ros]: 'ros-backend',
    [ServiceNames.vulnerability]: 'vulnerability-engine-manager-service',
  };
  return services[service] as unknown as keyof ServicesEndpoints;
};
function prepareServiceCall<T = Record<string, unknown>>(
  descriptor: APIDescriptor<T>
): ServiceCallFunction {
  if (config?.IS_DEVELOPMENT && descriptor?.mock) {
    return (headers, options) =>
      Promise.resolve(descriptor.mock(headers, options));
  }

  const { service, path, responseProcessor, request } = descriptor || {};
  const serviceConfig = config?.endpoints[getServiceEndpointMap(service)];
  if (!config?.IS_DEVELOPMENT && !serviceConfig) {
    return () =>
      Promise.reject(`Trying to reach unsupported service ${service}!`);
  }

  if (request) {
    return (headers, options) => {
      return request(headers, options).catch((error) => {
        console.log(error);
        return Promise.reject(error);
      });
    };
  }
  const URL = `http://${serviceConfig?.hostname}:${serviceConfig?.port}${path}`;
  return async (headers, options) => {
    let data;
    try {
      data = await axios.get(URL, { ...options, headers });
    } catch (error) {
      console.log('Unable to get report data: ', error);
      return Promise.reject(error);
    }
    return responseProcessor(data);
  };
}

export default prepareServiceCall;
