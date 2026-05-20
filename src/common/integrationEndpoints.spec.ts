import { Endpoint } from 'app-common-js';
import { ServiceNames } from '../integration/endpoints';
import {
  mergeClowderEndpoints,
  buildInternalRouteKey,
  resolveInternalRouteKey,
  rewriteInternalProxiedPath,
} from './integrationEndpoints';

const endpoint = (
  partial: Partial<Endpoint> & Pick<Endpoint, 'app' | 'name'>,
): Endpoint =>
  ({
    hostname: 'h.example.svc',
    port: 8000,
    tlsPort: 0,
    ...partial,
  }) as Endpoint;

describe('mergeClowderEndpoints', () => {
  it('returns empty map when there are no integrated endpoints', () => {
    expect(
      mergeClowderEndpoints(undefined, [
        endpoint({ app: 'unknown-app', name: 'api' }),
      ]),
    ).toEqual({});
  });

  it('uses app as key when that app appears only once', () => {
    const compliance = endpoint({
      app: 'compliance',
      name: 'service',
      hostname: 'compliance-service.ns.svc',
    });
    expect(mergeClowderEndpoints(undefined, [compliance])).toEqual({
      compliance: {
        app: 'compliance',
        hostname: 'compliance-service.ns.svc',
        name: 'service',
        port: 8000,
      },
    });
  });

  it('merges privateEndpoints before public and uses app-name keys when app repeats', () => {
    const manager = endpoint({
      app: 'vulnerability-engine',
      name: 'manager-service',
      hostname: 've-manager.ns.svc',
    });
    const admin = endpoint({
      app: 'vulnerability-engine',
      name: 'manager-admin-service',
      hostname: 've-admin.ns.svc',
    });
    const privateRow = endpoint({
      app: 'vulnerability-engine',
      name: 'listener-service',
      hostname: 've-listener.ns.svc',
    });

    const out = mergeClowderEndpoints([privateRow], [manager, admin]);

    expect(Object.keys(out).sort()).toEqual([
      'vulnerability-engine-listener-service',
      'vulnerability-engine-manager-admin-service',
      'vulnerability-engine-manager-service',
    ]);
    expect(out['vulnerability-engine-manager-service']?.hostname).toBe(
      've-manager.ns.svc',
    );
  });

  it('deduplicates same app and name across private and public lists', () => {
    const privateRow = endpoint({
      app: 'compliance',
      name: 'service',
      hostname: 'compliance-private.ns.svc',
    });
    const publicRow = endpoint({
      app: 'compliance',
      name: 'service',
      hostname: 'compliance-public.ns.svc',
    });
    expect(mergeClowderEndpoints([privateRow], [publicRow])).toEqual({
      compliance: {
        app: 'compliance',
        hostname: 'compliance-private.ns.svc',
        name: 'service',
        port: 8000,
      },
    });
  });

  it('uses app-name keys for distinct names across private and public lists', () => {
    const a = endpoint({
      app: 'ros-backend',
      name: 'api',
      hostname: 'ros-a.svc',
    });
    const b = endpoint({
      app: 'ros-backend',
      name: 'alt',
      hostname: 'ros-b.svc',
    });
    expect(mergeClowderEndpoints([a], [b])).toEqual({
      'ros-backend-api': {
        app: 'ros-backend',
        hostname: 'ros-a.svc',
        name: 'api',
        port: 8000,
      },
      'ros-backend-alt': {
        app: 'ros-backend',
        hostname: 'ros-b.svc',
        name: 'alt',
        port: 8000,
      },
    });
  });
});

describe('resolveInternalRouteKey', () => {
  it('falls back to plain service key when composite is missing', () => {
    const endpoints = {
      compliance: {
        app: 'compliance',
        hostname: 'c.svc',
        name: 'service',
        port: 8000,
      },
    };
    expect(
      resolveInternalRouteKey(ServiceNames.compliance, endpoints, 'service'),
    ).toBe('compliance');
  });

  it('uses composite key when present', () => {
    const endpoints = mergeClowderEndpoints(undefined, [
      endpoint({ app: 'ros-backend', name: 'api', hostname: 'a.svc' }),
      endpoint({ app: 'ros-backend', name: 'alt', hostname: 'b.svc' }),
    ]);
    expect(
      resolveInternalRouteKey(ServiceNames['ros-backend'], endpoints, 'api'),
    ).toBe('ros-backend-api');
  });
});

describe('buildInternalRouteKey', () => {
  it('appends deployment when clowderDeploymentName is set', () => {
    expect(
      buildInternalRouteKey(
        ServiceNames['vulnerability-engine'],
        'manager-service',
      ),
    ).toBe('vulnerability-engine-manager-service');
  });

  it('returns service only when deployment is omitted', () => {
    expect(buildInternalRouteKey(ServiceNames.compliance)).toBe('compliance');
  });
});

describe('rewriteInternalProxiedPath', () => {
  it('strips prefix with trailing path', () => {
    expect(
      rewriteInternalProxiedPath(
        'vulnerability-engine-manager-service',
        '/internal/vulnerability-engine-manager-service/api/vulnerability/v1/cves',
      ),
    ).toBe('/api/vulnerability/v1/cves');
  });

  it('returns empty string for exact prefix match', () => {
    expect(
      rewriteInternalProxiedPath('compliance', '/internal/compliance'),
    ).toBe('');
  });

  it('returns path unchanged when prefix does not match', () => {
    expect(rewriteInternalProxiedPath('compliance', '/api/foo')).toBe(
      '/api/foo',
    );
  });
});
