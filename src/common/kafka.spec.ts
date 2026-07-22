import config from './config';
import { getKafkaSASL, getKafkaSSL } from './kafka';
import { SASLOptions } from 'kafkajs';

describe('stage config', () => {
  it('should have ssl and ca configs', () => {
    const brokers = config?.kafka.brokers;
    expect(brokers[0].securityProtocol).toContain('SSL');
    const ssl = getKafkaSSL(brokers);
    expect(ssl).toBe(true);
    const saslOpts = getKafkaSASL(brokers);
    const sasl: SASLOptions = {
      username: brokers[0].sasl.username,
      password: brokers[0].sasl.password,
      mechanism: 'scram-sha-512',
    };
    expect(saslOpts).toEqual(sasl);
  });
});

describe('produceMessage', () => {
  const mockSend = jest.fn().mockResolvedValue(undefined);
  const mockConnect = jest.fn().mockResolvedValue(undefined);
  const mockProducer = { connect: mockConnect, send: mockSend };

  beforeEach(() => {
    jest.resetModules();
    mockConnect.mockClear();
    mockSend.mockClear();
    // jest.doMock is the runtime API; jest.mock at this scope would not be hoisted
    jest.doMock('kafkajs', () => ({
      Kafka: jest.fn().mockImplementation(() => ({
        producer: jest.fn().mockReturnValue(mockProducer),
      })),
    }));
  });

  afterEach(() => {
    jest.dontMock('kafkajs');
  });

  it('calls producer.connect once across sequential produceMessage calls', async () => {
    const { produceMessage } = await import('./kafka');
    await produceMessage('topic-a', { foo: 1 });
    await produceMessage('topic-a', { foo: 2 });
    await produceMessage('topic-b', { foo: 3 });
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('calls producer.connect once when produceMessage is called concurrently', async () => {
    const { produceMessage } = await import('./kafka');
    await Promise.all([
      produceMessage('topic-a', { foo: 1 }),
      produceMessage('topic-a', { foo: 2 }),
      produceMessage('topic-b', { foo: 3 }),
    ]);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });
});
