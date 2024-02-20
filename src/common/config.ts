import ServiceNames from './service-names';
import 'dotenv/config';
import {
  Endpoint,
  ObjectBucket,
  IsClowderEnabled,
  KafkaBroker,
  KafkaTopic,
} from 'app-common-js';
import { Config } from 'app-common-js/index';

export type ServicesEndpoints = Omit<
  {
    [key in ServiceNames]: Endpoint;
  } & {
    'advisor-backend': Endpoint;
    'ros-backend': Endpoint;
    'vulnerability-engine-manager-service': Endpoint;
  },
  'advisor' | 'ros' | 'vulnerability'
>;

const defaultConfig: {
  webPort: number;
  metricsPort: number;
  metricsPath: string;
  endpoints: Partial<ServicesEndpoints>;
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
  APIPrefix: string;
  IS_PRODUCTION: boolean;
  IS_DEVELOPMENT: boolean;
  OPTIONS_HEADER_NAME: string;
  IDENTITY_CONTEXT_KEY: string;
  IDENTITY_HEADER_KEY: string;
  ACCOUNT_ID: string;
  LOG_LEVEL: string;
} = {
  webPort: 8000,
  metricsPort: 9000,
  metricsPath: '/metrics',
  endpoints: {},
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
        requestedName: 'pdfs',
        name: 'pdfs',
      },
    ],
  },
  kafka: {
    brokers: [
      {
        hostname: 'localhost',
        port: 9092,
        authType: '',
        caCert: '',
        socketAddress: 'localhost:9092',
        securityProtocol: '',
        saslConfig: {
          username: 'me',
          password: 'me',
          saslMechanism: '',
          securityProtocol: '',
        },
      },
    ],
    topics: [
      {
        requestedName: 'updated-report',
        name: 'updated-report',
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
  ACCOUNT_ID: '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
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

function initializeConfig() {
  console.log('Starting config');
  let isClowderEnabled = false;
  const endpoints: Partial<ServicesEndpoints> = {};
  try {
    let config: typeof defaultConfig = {
      ...defaultConfig,
    };
    /**
     * Has to be loaded like this because it crashes in dev environment because it does not have some files on filesystem
     * TODO: Open issue over at https://github.com/RedHatInsights/app-common-js
     */
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const clowder = new Config();
    isClowderEnabled = IsClowderEnabled();
    if (isClowderEnabled) {
      const clowderConfig = clowder.LoadedConfig();
      if (clowderConfig.endpoints) {
        clowderConfig.endpoints.forEach((endpoint) => {
          // special case for vulnerability
          if (endpoint.name === 'manager-service') {
            endpoints['vulnerability-engine-manager-service'] = endpoint;
          } else {
            endpoints[endpoint.app as keyof ServicesEndpoints] = endpoint;
          }
        });
      }
      // if (clowder.KafkaServers()) {
      //   const brokers = clowder.KafkaServers();
      //   const configuredBrokers: string[] = [];
      //   brokers.map((v: KafkaBroker) => {
      //     configuredBrokers.push(v.socketAddress);
      //   });
      //   config.KAFKA_BROKERS = configuredBrokers;
      // }
      config = {
        ...defaultConfig,
        ...clowderConfig,
        endpoints,
      };
    }
    return config;
  } catch (error) {
    return defaultConfig;
  }
}

const instanceConfig = initializeConfig();

export default instanceConfig;
