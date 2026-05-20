import { Endpoint } from 'app-common-js';
import {
  ServiceNames,
  IntegrationEndpointsMap,
} from '../integration/endpoints';

function isIntegratedApp(app: string): app is ServiceNames {
  return Object.values(ServiceNames).includes(app as ServiceNames);
}

function isIntegratedEndpoint(
  endpoint: Endpoint,
): endpoint is Endpoint & { app: ServiceNames } {
  return isIntegratedApp(endpoint.app);
}

export type IntegrationRouteKey = ServiceNames | `${ServiceNames}-${string}`;

export function buildInternalRouteKey(
  service: ServiceNames,
  clowderDeploymentName?: string,
): IntegrationRouteKey {
  return clowderDeploymentName
    ? `${service}-${clowderDeploymentName}`
    : service;
}

export function mergeClowderEndpoints(
  privateEndpoints: Endpoint[] | undefined,
  publicEndpoints: Endpoint[],
): IntegrationEndpointsMap {
  const merged: Endpoint[] = [...(privateEndpoints ?? []), ...publicEndpoints];
  const seen = new Set<string>();
  const integrated = merged.filter(
    (ep): ep is Endpoint & { app: ServiceNames } => {
      if (!isIntegratedEndpoint(ep)) {
        return false;
      }
      const id = `${ep.app}/${ep.name}`;
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    },
  );
  const appCount = integrated.reduce<Record<string, number>>(
    (acc, endpoint) => {
      acc[endpoint.app] = (acc[endpoint.app] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const out: IntegrationEndpointsMap = {};
  for (const endpoint of integrated) {
    const key = buildInternalRouteKey(
      endpoint.app,
      (appCount[endpoint.app] ?? 0) > 1 ? endpoint.name : undefined,
    );
    out[key] = {
      app: endpoint.app,
      hostname: endpoint.hostname,
      name: endpoint.name,
      port: endpoint.port,
    };
  }
  return out;
}

export function resolveInternalRouteKey(
  service: ServiceNames,
  endpoints: IntegrationEndpointsMap,
  clowderDeploymentName?: string,
): IntegrationRouteKey | undefined {
  const candidates: IntegrationRouteKey[] = [];
  if (clowderDeploymentName) {
    candidates.push(buildInternalRouteKey(service, clowderDeploymentName));
  }
  candidates.push(service);
  return candidates.find((key) => endpoints[key] !== undefined);
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
