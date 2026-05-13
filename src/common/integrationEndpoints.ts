import { Endpoint } from 'app-common-js';
import {
  ServiceNames,
  IntegrationEndpointsMap,
} from '../integration/endpoints';

function isIntegratedApp(app: string): app is ServiceNames {
  return Object.values(ServiceNames).includes(app as ServiceNames);
}

export function mergeClowderEndpoints(
  privateEndpoints: Endpoint[] | undefined,
  publicEndpoints: Endpoint[],
): IntegrationEndpointsMap {
  const merged: Endpoint[] = [...(privateEndpoints ?? []), ...publicEndpoints];
  const integrated = merged.filter((endpoint) => isIntegratedApp(endpoint.app));
  const appCount = integrated.reduce<Record<string, number>>(
    (acc, endpoint) => {
      acc[endpoint.app] = (acc[endpoint.app] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const out: IntegrationEndpointsMap = {};
  for (const endpoint of integrated) {
    const key =
      (appCount[endpoint.app] ?? 0) > 1
        ? `${endpoint.app}-${endpoint.name}`
        : endpoint.app;
    out[key] = {
      app: endpoint.app,
      hostname: endpoint.hostname,
      name: endpoint.name,
      port: endpoint.port,
    };
  }
  return out;
}

export function buildInternalRouteKey(
  service: ServiceNames,
  clowderDeploymentName?: string,
): string {
  return clowderDeploymentName
    ? `${service}-${clowderDeploymentName}`
    : service;
}

export function rewriteInternalProxiedPath(
  routeKey: string,
  path: string,
): string {
  const prefix = `/internal/${routeKey}`;
  if (path.startsWith(`${prefix}/`)) {
    return path.slice(prefix.length);
  }
  if (path === prefix) {
    return '';
  }
  return path;
}
