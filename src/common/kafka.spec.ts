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
  const mockDisconnect = jest.fn().mockResolvedValue(undefined);
  const mockProducer = {
    connect: mockConnect,
    send: mockSend,
    disconnect: mockDisconnect,
  };

  beforeEach(() => {
    jest.resetModules();
    mockConnect.mockClear();
    mockSend.mockClear();
    mockDisconnect.mockClear();
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

  it('retries connect after a connection failure', async () => {
    mockConnect.mockRejectedValueOnce(new Error('broker unavailable'));
    const { produceMessage } = await import('./kafka');
    await expect(produceMessage('topic-a', { foo: 1 })).rejects.toThrow(
      'broker unavailable',
    );
    mockConnect.mockResolvedValueOnce(undefined);
    await produceMessage('topic-a', { foo: 2 });
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('disconnects and rejects new sends after shutdown', async () => {
    const { produceMessage, disconnectProducer } = await import('./kafka');
    await produceMessage('topic-a', { foo: 1 });
    await disconnectProducer();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    await expect(produceMessage('topic-a', { foo: 2 })).rejects.toThrow(
      'Kafka producer is shutting down',
    );
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('disconnectProducer disconnects even when never connected', async () => {
    const { disconnectProducer } = await import('./kafka');
    await disconnectProducer();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnectProducer times out when connect hangs indefinitely', async () => {
    jest.useFakeTimers();
    let resolveConnect!: () => void;
    mockConnect.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveConnect = resolve;
      }),
    );

    const { produceMessage, disconnectProducer } = await import('./kafka');
    const producePromise = produceMessage('topic-a', { foo: 1 });
    const disconnectPromise = disconnectProducer();

    await jest.advanceTimersByTimeAsync(5_000);

    await expect(disconnectPromise).resolves.toBeUndefined();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);

    resolveConnect();
    await expect(producePromise).rejects.toThrow(
      'Kafka producer is shutting down',
    );
    jest.useRealTimers();
  });

  it('drains in-flight sends before disconnecting', async () => {
    let resolveSend!: () => void;
    mockSend.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );

    const { produceMessage, disconnectProducer } = await import('./kafka');
    const producePromise = produceMessage('topic-a', { foo: 1 });
    // Yield so ensureConnected() resolves and mockSend is called before disconnectProducer
    await new Promise((r) => setImmediate(r));
    const disconnectPromise = disconnectProducer();

    expect(mockDisconnect).not.toHaveBeenCalled();

    resolveSend();
    await producePromise;
    await disconnectPromise;

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('does not throw when disconnecting while connect is pending or failing', async () => {
    let rejectConnect!: (err: Error) => void;
    const connectPromise = new Promise<void>((_, reject) => {
      rejectConnect = reject;
    });
    mockConnect.mockReturnValueOnce(connectPromise);

    const { produceMessage, disconnectProducer } = await import('./kafka');
    const producePromise = produceMessage('topic-a', { foo: 1 });
    const disconnectPromise = disconnectProducer();

    rejectConnect(new Error('broker unavailable'));

    await expect(disconnectPromise).resolves.toBeUndefined();
    await expect(producePromise).rejects.toThrow('broker unavailable');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
