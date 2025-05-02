import { createProxyMiddleware } from 'http-proxy-middleware';
import instanceConfig from '../../common/config';
import { ServiceNames } from '../../integration/endpoints';
import { Endpoint } from 'app-common-js';
import { apiLogger } from '../../common/logging';
import { HttpsProxyAgent } from 'https-proxy-agent';

const API_HOST = instanceConfig.scalprum.apiHost;
const PROXY_AGENT = instanceConfig.scalprum.proxyAgent;

function createInternalProxies() {
  // skip internal routing if API_HOST is set
  if (API_HOST && API_HOST !== 'blank') {
    const internalRegEx = /^\/internal\/[^/]+/;
    const proxy = createProxyMiddleware({
      ...(PROXY_AGENT ? { agent: new HttpsProxyAgent(PROXY_AGENT) } : {}),
      logger: apiLogger,
      target: API_HOST,
      changeOrigin: true,
      pathFilter: (path) => path.startsWith('/internal'),
      pathRewrite: (path) => path.replace(internalRegEx, ''),
    });
    return [proxy];
  }
  const meta = Object.entries(instanceConfig.endpoints).reduce<
    Partial<{
      [key in ServiceNames]: Endpoint;
    }>
  >((acc, [serviceName, endpoint]) => {
    const index: ServiceNames = ServiceNames[serviceName as ServiceNames];
    if (ServiceNames[index]) {
      acc[ServiceNames[index]] = endpoint;
    }
    return acc;
  }, {});

  const internalProxies = Object.entries(meta).map(
    ([serviceName, endpoint]) => {
      return createProxyMiddleware({
        logger: apiLogger,
        target: `http://${endpoint.hostname}:${endpoint.port}`,
        changeOrigin: true,
        pathFilter: (path) => path.startsWith(`/internal/${serviceName}`),
        pathRewrite: {
          [`^/internal/${serviceName}`]: '',
        },
      });
    },
  );

  return internalProxies;
}

export default createInternalProxies;
