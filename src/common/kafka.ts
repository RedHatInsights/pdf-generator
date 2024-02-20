import { Kafka, SASLOptions } from 'kafkajs';
import config from '../common/config';
import { apiLogger } from './logging';
import PdfCache from '../browser/helpers';
import { KafkaBroker } from 'app-common-js';

const kafkaSocketAddresses = (brokers: KafkaBroker[]) => {
  const socketAddresses: string[] = [];
  brokers.map((v: KafkaBroker) => {
    apiLogger.debug(v);
    socketAddresses.push(`${v.hostname}:${v.port}`);
  });
  return socketAddresses;
};

const getKafkaSSL = () => {
  if (config?.kafka.brokers[0].caCert) {
    return {
      ca: config?.kafka.brokers[0].caCert,
    };
  }
  return false;
};

// Insanity: https://github.com/tulios/kafkajs/issues/1314
const getKafkaSASL = () => {
  const cfg = config?.kafka.brokers[0];
  if (cfg.saslConfig !== undefined) {
    switch (cfg.saslConfig.saslMechanism) {
      case 'plain': {
        const sasl: SASLOptions = {
          username: cfg.saslConfig.username,
          password: cfg.saslConfig.password,
          mechanism: 'plain',
        };
        return sasl;
      }
      case 'scram-sha-256': {
        const sasl: SASLOptions = {
          username: cfg.saslConfig.username,
          password: cfg.saslConfig.password,
          mechanism: 'scram-sha-256',
        };
        return sasl;
      }
      case 'scram-sha-512': {
        const sasl: SASLOptions = {
          username: cfg.saslConfig.username,
          password: cfg.saslConfig.password,
          mechanism: 'scram-sha-512',
        };
        return sasl;
      }
    }
  }

  return undefined;
};

const KafkaClient = () => {
  const brokers = config?.kafka.brokers;
  const sasl = getKafkaSASL();
  const ssl = getKafkaSSL();
  if (ssl && sasl) {
    apiLogger.debug('sasl and ssl');
    return new Kafka({
      clientId: 'crc-pdf-gen',
      brokers: kafkaSocketAddresses(brokers),
      ssl: ssl,
      sasl: sasl,
    });
  }
  if (ssl) {
    apiLogger.debug('just ssl');
    return new Kafka({
      clientId: 'crc-pdf-gen',
      brokers: kafkaSocketAddresses(brokers),
      ssl: ssl,
    });
  }
  apiLogger.debug('no ssl');
  return new Kafka({
    clientId: 'crc-pdf-gen',
    brokers: kafkaSocketAddresses(brokers),
    ssl: false,
  });
};

const pdfCache = PdfCache.getInstance();

export async function produceMessage(topic: string, message: unknown) {
  const kafka = KafkaClient();
  const producer = kafka.producer();

  await producer.connect();
  await producer.send({
    topic: topic,
    messages: [{ value: JSON.stringify(message) }],
  });

  await producer.disconnect();
}
export async function consumeMessages(topic: string) {
  const kafka = KafkaClient();
  const consumer = kafka.consumer({ groupId: 'test-group' });

  await consumer.connect();
  await consumer.subscribe({ topic: topic, fromBeginning: true });

  await consumer.run({
    // ESlint is upset here but it has to be async due to kafkajs
    // eslint-disable-next-line @typescript-eslint/require-await
    eachMessage: async ({ message }) => {
      apiLogger.debug({
        value: message.value,
      });
      const cacheObject = JSON.parse(message.value?.toString() as string);
      pdfCache.setItem(cacheObject?.id, {
        status: cacheObject.status,
        filepath: cacheObject.filepath,
      });
    },
  });
}
