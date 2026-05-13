import 'dotenv/config';
import {
  ObjectBucket,
  IsClowderEnabled,
  KafkaBroker,
  KafkaTopic,
  Config,
  Endpoint,
} from 'app-common-js';
import { UPDATE_TOPIC } from '../browser/constants';
import * as fs from 'fs';
import {
  PREFERRED_CLOWDER_DEPLOYMENT_NAME_BY_SERVICE,
  ServiceNames,
  ServicesEndpoints,
} from '../integration/endpoints';

const defaultConfig: {
  webPort: number;
  metricsPort: number;
  metricsPath: string;
  endpoints: Partial<ServicesEndpoints>;
  tlsCAPath: string;
  objectStore: {
    hostname: string;
    port: number;
    accessKey: string;
    secretKey: string;
    tls: boolean;
    buckets: ObjectBucket[];
  };
  kafka: {
    brokers: KafkaBroker[];
    topics: KafkaTopic[];
  };
  kafkaCaLocation: string;
  APIPrefix: string;
  IS_PRODUCTION: boolean;
  IS_DEVELOPMENT: boolean;
  OPTIONS_HEADER_NAME: string;
  IDENTITY_CONTEXT_KEY: string;
  IDENTITY_HEADER_KEY: string;
  JWT_COOKIE_NAME: string;
  AUTHORIZATION_HEADER_KEY: string;
  AUTHORIZATION_CONTEXT_KEY: string;
  ACCOUNT_ID: string;
  LOG_LEVEL: string;
  scalprum: {
    // for proxy request to /api
    apiHost: string;
    // for proxy request to /apps
    assetsHost: string;
    // request proxy agent
    proxyAgent?: string;
  };
} = {
  webPort: 8000,
  metricsPort: 9001,
  metricsPath: '/metrics',
  endpoints: {},
  tlsCAPath: '',
  objectStore: {
    hostname: 'localhost',
    port: 9100,
    accessKey: process.env.MINIO_ACCESS_KEY as string,
    secretKey: process.env.MINIO_SECRET_KEY as string,
    tls: false,
    buckets: [
      {
        accessKey: process.env.MINIO_ACCESS_KEY as string,
        secretKey: process.env.MINIO_SECRET_KEY as string,
        requestedName: 'crc-generated-pdfs',
        name: 'crc-generated-pdfs',
        region: 'us-east-1',
        tls: false,
        endpoint: 'localhost',
      },
    ],
  },
  kafkaCaLocation: '/tmp/kafkaca',
  kafka: {
    brokers: [
      {
        hostname: 'localhost',
        port: 9092,
        authtype: '',
        cacert: '',
        securityProtocol: '',
        sasl: {
          username: 'me',
          password: 'me',
          saslMechanism: '',
          securityProtocol: '',
        },
      },
    ],
    topics: [
      {
        requestedName: `${UPDATE_TOPIC}`,
        name: `${UPDATE_TOPIC}`,
        consumerGroupName: '',
      },
    ],
  },
  APIPrefix: '/api/crc-pdf-generator',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  IS_DEVELOPMENT: process.env.NODE_ENV === 'development',
  OPTIONS_HEADER_NAME: 'x-pdf-gen-options',
  IDENTITY_CONTEXT_KEY: 'identity',
  IDENTITY_HEADER_KEY: 'x-rh-identity',
  AUTHORIZATION_HEADER_KEY: 'Authorization',
  AUTHORIZATION_CONTEXT_KEY: 'x-pdf-auth',
  JWT_COOKIE_NAME: 'cs_jwt',
  ACCOUNT_ID: '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
  scalprum: {
    apiHost: process.env.API_HOST || 'blank',
    assetsHost: process.env.ASSETS_HOST || 'blank',
    proxyAgent:
      process.env.PROXY_AGENT &&
      process.env.PROXY_AGENT.length > 0 &&
      process.env.PROXY_AGENT !== 'blank'
        ? process.env.PROXY_AGENT
        : undefined,
  },
};

/**
 * 
 * endpoints: [
    {
      app: 'crc-pdf-generator',
      hostname: 'crc-pdf-generator-api.ephemeral-twdkua.svc',
      name: 'api',
      port: 8000
    },
    {
      app: 'compliance',
      hostname: 'compliance-service.ephemeral-twdkua.svc',
      name: 'service',
      port: 8000
    }
  ],
 */

function pickClowderEndpointForApp(
  rows: Endpoint[],
  app: ServiceNames,
): Endpoint {
  if (rows.length <= 1) {
    return rows[0];
  }
  const preferredName = PREFERRED_CLOWDER_DEPLOYMENT_NAME_BY_SERVICE[app];
  if (preferredName) {
    const match = rows.find((e) => e.name === preferredName);
    if (match) {
      return match;
    }
  }
  return rows[rows.length - 1];
}

function mergeClowderDependencyEndpoints(
  privateEndpoints: Endpoint[] | undefined,
  publicEndpoints: Endpoint[] | undefined,
  out: Partial<ServicesEndpoints>,
) {
  const byApp = new Map<string, Endpoint[]>();
  const push = (endpoint: Endpoint) => {
    const list = byApp.get(endpoint.app) ?? [];
    list.push(endpoint);
    byApp.set(endpoint.app, list);
  };
  privateEndpoints?.forEach(push);
  publicEndpoints?.forEach(push);

  byApp.forEach((rows, appKey) => {
    const app = appKey as ServiceNames;
    const resolvedEndpoint = pickClowderEndpointForApp(rows, app);
    out[app] = {
      app: resolvedEndpoint.app,
      hostname: resolvedEndpoint.hostname,
      name: resolvedEndpoint.name,
      port: resolvedEndpoint.port,
    };
  });
}

function initializeConfig() {
  let isClowderEnabled = false;
  const endpoints: Partial<ServicesEndpoints> = {};

  try {
    let config: typeof defaultConfig = {
      ...defaultConfig,
      endpoints,
    };
    const clowder: Config = new Config();
    isClowderEnabled = IsClowderEnabled();
    if (isClowderEnabled) {
      const clowderConfig = clowder.LoadedConfig();
      try {
        mergeClowderDependencyEndpoints(
          clowderConfig.privateEndpoints,
          clowderConfig.endpoints,
          endpoints,
        );
      } catch (error) {
        console.log('Could not merge Clowder dependency endpoints', error);
      }
      if (clowderConfig.kafka.brokers[0].cacert != undefined) {
        try {
          fs.writeFileSync(
            '/tmp/kafkaca',
            clowderConfig.kafka.brokers[0].cacert,
          );
        } catch (error) {
          console.log(error);
        }
      }
      config = {
        ...defaultConfig,
        ...clowderConfig,
        endpoints,
      };
    }
    return config;
  } catch {
    return defaultConfig;
  }
}
const instanceConfig = initializeConfig();

export default instanceConfig;
