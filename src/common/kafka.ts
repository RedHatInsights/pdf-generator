import {
  Kafka,
  SASLOptions,
  logLevel as kafkaLogLevel,
  type LogEntry,
} from 'kafkajs';
import config from '../common/config';
import { apiLogger } from './logging';
import PdfCache, { PDFComponent } from './pdfCache';
import { KafkaBroker } from 'app-common-js';
import * as fs from 'fs';
import * as os from 'os';

const kafkaSocketAddresses = (brokers: KafkaBroker[]) => {
  const socketAddresses: string[] = [];
  brokers.map((v: KafkaBroker) => {
    socketAddresses.push(`${v.hostname}:${v.port}`);
  });
  return socketAddresses;
};

export const getKafkaSSL = (brokers: KafkaBroker[]) => {
  const cfg = brokers[0];
  let ssl: boolean | { ca: Buffer[] } = false;
  if (cfg.securityProtocol && cfg.securityProtocol.includes('SSL')) {
    ssl = true;
  }

  if (cfg.cacert) {
    ssl = {
      ca: [fs.readFileSync('/tmp/kafkaca')],
    };
  }
  return ssl;
};

// Insanity: https://github.com/tulios/kafkajs/issues/1314
export const getKafkaSASL = (brokers: KafkaBroker[]) => {
  const cfg = brokers[0];
  if (cfg.authtype !== undefined) {
    switch (cfg.sasl.saslMechanism) {
      case 'plain': {
        const sasl: SASLOptions = {
          username: cfg.sasl.username,
          password: cfg.sasl.password,
          mechanism: 'plain',
        };
        return sasl;
      }
      case 'SCRAM-SHA-256': {
        const sasl: SASLOptions = {
          username: cfg.sasl.username,
          password: cfg.sasl.password,
          mechanism: 'scram-sha-256',
        };
        return sasl;
      }
      case 'SCRAM-SHA-512': {
        const sasl: SASLOptions = {
          username: cfg.sasl.username,
          password: cfg.sasl.password,
          mechanism: 'scram-sha-512',
        };
        return sasl;
      }
    }
  }

  return undefined;
};

const mapSyslogLevelToKafkaLogLevel = (syslogLevel: string): kafkaLogLevel => {
  switch (syslogLevel) {
    case 'emerg':
    case 'alert':
    case 'crit':
    case 'error':
      return kafkaLogLevel.ERROR;
    case 'warning':
    case 'notice':
      return kafkaLogLevel.WARN;
    case 'info':
      return kafkaLogLevel.INFO;
    case 'debug':
      return kafkaLogLevel.DEBUG;
    default:
      return kafkaLogLevel.INFO;
  }
};

const kafkaLogCreator =
  () =>
  ({ namespace, level, log }: LogEntry) => {
    const { message: msg, timestamp, ...rest } = log;
    const extras = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    const message = `[${namespace}] ${msg}${extras}`;
    switch (level) {
      case kafkaLogLevel.ERROR:
        apiLogger.error(message);
        break;
      case kafkaLogLevel.WARN:
        apiLogger.warning(message);
        break;
      case kafkaLogLevel.INFO:
        apiLogger.info(message);
        break;
      case kafkaLogLevel.DEBUG:
        apiLogger.debug(message);
        break;
    }
  };

const kafkaLoggingOptions = {
  logLevel: mapSyslogLevelToKafkaLogLevel(config?.LOG_LEVEL ?? 'info'),
  logCreator: kafkaLogCreator,
};

const KafkaClient = (): Kafka | null => {
  const brokers = config?.kafka?.brokers ?? [];
  if (brokers.length === 0) {
    apiLogger.debug('no brokers configured, Kafka disabled');
    return null;
  }
  const sasl = getKafkaSASL(brokers);
  const ssl = getKafkaSSL(brokers);
  if (ssl && sasl) {
    apiLogger.debug('sasl');
    return new Kafka({
      clientId: 'crc-pdf-gen',
      brokers: kafkaSocketAddresses(brokers),
      ssl: ssl,
      sasl: sasl,
      ...kafkaLoggingOptions,
    });
  }
  apiLogger.debug('no ssl');
  return new Kafka({
    clientId: 'crc-pdf-gen',
    brokers: kafkaSocketAddresses(brokers),
    ssl: false,
    ...kafkaLoggingOptions,
  });
};

const pdfCache = PdfCache.getInstance();
const kafka = KafkaClient();

const producer = kafka?.producer() ?? null;
let connected: Promise<void> | null = null;
let shuttingDown = false;
const inflightSends = new Set<Promise<unknown>>();

function ensureConnected() {
  if (!producer) {
    return Promise.resolve();
  }
  if (!connected) {
    connected = producer.connect().catch((err) => {
      connected = null;
      throw err;
    });
  }
  return connected;
}

const DISCONNECT_TIMEOUT_MS = 5_000;

export async function disconnectProducer() {
  shuttingDown = true;
  if (!producer) {
    return;
  }
  if (connected) {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<void>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('Kafka connect timed out during shutdown')),
        DISCONNECT_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([connected, timeout]);
    } catch {
      // timeout or connect failure — proceed with disconnect
    } finally {
      clearTimeout(timeoutId!);
    }
    connected = null;
  }
  await Promise.allSettled([...inflightSends]);
  await producer.disconnect();
}

export async function produceMessage(topic: string, message: unknown) {
  if (!kafka || !producer) {
    apiLogger.debug('Kafka disabled, skipping produce');
    return;
  }
  if (shuttingDown) {
    throw new Error('Kafka producer is shutting down');
  }
  await ensureConnected();
  if (shuttingDown) {
    throw new Error('Kafka producer is shutting down');
  }
  const send = producer.send({
    topic: topic,
    messages: [{ value: JSON.stringify(message) }],
  });
  inflightSends.add(send);
  try {
    await send;
  } finally {
    inflightSends.delete(send);
  }
}

export async function consumeMessages(topic: string) {
  if (!kafka) {
    apiLogger.debug('Kafka disabled, skipping consume');
    return;
  }
  const consumer = kafka.consumer({ groupId: `pdf-gen-${os.hostname()}` });
  await consumer.connect();
  // Don't read from the beginning. Messages from not-yet-expired objects on the topic
  // will contain paths to PDFs that are not on the new pod
  await consumer.subscribe({ topic: topic });

  await consumer.run({
    // ESlint is upset here but it has to be async due to kafkajs
    eachMessage: async ({ message }) => {
      apiLogger.debug(
        JSON.stringify({
          value: message.value?.toString(),
        }),
      );
      const cacheObject = JSON.parse(message.value?.toString() as string);
      let updateMessage;
      try {
        if (
          cacheObject.collectionId !== undefined &&
          cacheObject.collectionId !== ''
        ) {
          updateMessage = cacheObject as PDFComponent;
          apiLogger.debug(
            `Updated message for collection ${updateMessage.collectionId}`,
          );
        } else {
          throw new Error('Invalid message format');
        }
        pdfCache.addToCollection(updateMessage.collectionId, {
          status: updateMessage.status,
          filepath: updateMessage.filepath,
          collectionId: updateMessage.collectionId,
          componentId: updateMessage.componentId,
          numPages: updateMessage?.numPages || 0,
          error: updateMessage?.error || `''`,
          order: updateMessage?.order,
          expectedLength: updateMessage.expectedLength,
        });
      } catch (error) {
        apiLogger.debug(
          `Message sync error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  });
}
