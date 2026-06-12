import { createProxyMiddleware } from 'http-proxy-middleware';
import instanceConfig from '../../common/config';
import { Endpoint } from 'app-common-js';
import { hpmLogger } from '../../common/logging';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { rewriteInternalProxiedPath } from '../../common/integrationEndpoints';

const API_HOST = instanceConfig.scalprum.apiHost;
const PROXY_AGENT = instanceConfig.scalprum.proxyAgent;

function createInternalProxies() {
  // skip internal routing if API_HOST is set
  if (API_HOST && API_HOST !== 'blank') {
    const internalRegEx = /^\/internal\/[^/]+/;
    const proxy = createProxyMiddleware({
      ...(PROXY_AGENT ? { agent: new HttpsProxyAgent(PROXY_AGENT) } : {}),
      logger: hpmLogger,
      target: API_HOST,
      secure: false,
      changeOrigin: true,
      pathFilter: (path) => path.startsWith('/internal/'),
      pathRewrite: (path) => path.replace(internalRegEx, ''),
      on: {
        proxyReq: (proxyReq) => {
          const authHeader = proxyReq.getHeader(
            instanceConfig.AUTHORIZATION_CONTEXT_KEY,
          );
          if (authHeader) {
            proxyReq.setHeader(
              instanceConfig.AUTHORIZATION_HEADER_KEY,
              authHeader,
            );
          }
          proxyReq.removeHeader(instanceConfig.AUTHORIZATION_CONTEXT_KEY);
        },
      },
    });
    return [proxy];
  }

  return Object.entries(instanceConfig.endpoints)
    .filter((pair): pair is [string, Endpoint] => pair[1] !== undefined)
    .map(([routeKey, endpoint]) => {
      const prefix = `/internal/${routeKey}`;
      return createProxyMiddleware({
        logger: hpmLogger,
        target: `http://${endpoint.hostname}:${endpoint.port}`,
        changeOrigin: true,
        pathFilter: (path) => path.startsWith(`${prefix}/`) || path === prefix,
        pathRewrite: (path) => rewriteInternalProxiedPath(routeKey, path),
      });
    });
}

export default createInternalProxies;
