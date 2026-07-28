import {
  createPdfReadyGate,
  markPdfReady,
  markReadinessContract,
  runReadinessGates,
} from './pdfReadiness';

type DomGlobals = {
  window: Record<string, unknown>;
  document: { fonts: { ready: Promise<unknown> } };
  requestAnimationFrame?: (cb: (time: number) => void) => number;
};

function ensureDomGlobals() {
  const g = globalThis as typeof globalThis & DomGlobals;
  if (!(g as { window?: unknown }).window) {
    (g as DomGlobals).window = g as unknown as Record<string, unknown>;
  }
  if (!(g as { document?: unknown }).document) {
    Object.defineProperty(g, 'document', {
      configurable: true,
      writable: true,
      value: {
        fonts: { ready: Promise.resolve(undefined as unknown) },
      },
    });
  }
}

ensureDomGlobals();

function setFontsReady() {
  const g = globalThis as typeof globalThis & DomGlobals;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (g.document as any).fonts = {
    ready: Promise.resolve(),
  };
}
function createMockRoot(attrs: Record<string, string> = {}) {
  const attributes = { ...attrs };
  return {
    attributes,
    setAttribute: (key: string, value: string) => {
      attributes[key] = value;
    },
    getAttribute: (key: string) => attributes[key],
    querySelectorAll: () => [],
  } as unknown as Element;
}

describe('markReadinessContract', () => {
  it('sets contract attributes when renderReadiness is explicit-v1', () => {
    const root = createMockRoot();
    markReadinessContract(root, 'explicit-v1');
    expect(root.getAttribute('data-pdf-readiness-contract')).toBe('v1');
    expect(root.getAttribute('data-pdf-ready')).toBe('false');
  });

  it('does nothing when renderReadiness is undefined', () => {
    const root = createMockRoot();
    markReadinessContract(root, undefined);
    expect(root.getAttribute('data-pdf-readiness-contract')).toBeUndefined();
  });

  it('does nothing when root is null', () => {
    expect(() => markReadinessContract(null, 'explicit-v1')).not.toThrow();
  });
});

describe('createPdfReadyGate', () => {
  it('does not resolve until resolve is called', async () => {
    const gate = createPdfReadyGate();
    let settled = false;
    const pending = gate.promise.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    gate.resolve();
    await pending;
    expect(settled).toBe(true);
    expect(
      (globalThis as { __callbackTimestamp?: number }).__callbackTimestamp,
    ).toEqual(expect.any(Number));
  });
});

describe('runReadinessGates', () => {
  const g = globalThis as typeof globalThis & DomGlobals;
  const originalFonts = g.document.fonts;
  const originalRaf = g.requestAnimationFrame;

  beforeEach(() => {
    setFontsReady();
    g.requestAnimationFrame = (cb: (time: number) => void) => {
      cb(0);
      return 0;
    };
  });

  afterEach(() => {
    g.document.fonts = originalFonts;
    g.requestAnimationFrame = originalRaf;
    delete (g as { __fontTimestamp?: number }).__fontTimestamp;
  });

  it('stamps __fontTimestamp after fonts and completes gates', async () => {
    const container = createMockRoot();
    await runReadinessGates(container);
    expect((g as { __fontTimestamp?: number }).__fontTimestamp).toEqual(
      expect.any(Number),
    );
  });

  it('waits for incomplete images before finishing', async () => {
    const listeners: Record<string, Array<() => void>> = {};
    const img = {
      complete: false,
      addEventListener: (event: string, handler: () => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      },
      decode: jest.fn().mockResolvedValue(undefined),
    };
    const container = {
      querySelectorAll: () => [img],
    } as unknown as Element;

    let gatesDone = false;
    const gatesPromise = runReadinessGates(container).then(() => {
      gatesDone = true;
    });

    // Flush until image listeners are registered (after fonts gate)
    for (let i = 0; i < 10 && !listeners.load; i++) {
      await Promise.resolve();
    }
    expect(gatesDone).toBe(false);
    expect(listeners.load).toBeDefined();

    listeners.load.forEach((fn) => fn());
    await gatesPromise;
    expect(gatesDone).toBe(true);
    expect(img.decode).toHaveBeenCalled();
  });
});

describe('markPdfReady', () => {
  it('sets data-pdf-ready and stamps __readyTimestamp', () => {
    const root = createMockRoot({ 'data-pdf-ready': 'false' });
    markPdfReady(root);
    expect(root.getAttribute('data-pdf-ready')).toBe('true');
    expect(
      (globalThis as { __readyTimestamp?: number }).__readyTimestamp,
    ).toEqual(expect.any(Number));
  });
});

describe('onPdfReady then gates ordering', () => {
  const g = globalThis as typeof globalThis & DomGlobals;
  const originalFonts = g.document.fonts;
  const originalRaf = g.requestAnimationFrame;

  beforeEach(() => {
    setFontsReady();
    g.requestAnimationFrame = (cb: (time: number) => void) => {
      cb(0);
      return 0;
    };
  });

  afterEach(() => {
    g.document.fonts = originalFonts;
    g.requestAnimationFrame = originalRaf;
  });

  it('does not run gates until onPdfReady resolves the gate', async () => {
    const gate = createPdfReadyGate();
    const container = createMockRoot();
    let gatesStarted = false;

    const flow = (async () => {
      await gate.promise;
      gatesStarted = true;
      await runReadinessGates(container);
      markPdfReady(container);
    })();

    await Promise.resolve();
    expect(gatesStarted).toBe(false);

    gate.resolve();
    await flow;

    expect(gatesStarted).toBe(true);
    expect(container.getAttribute('data-pdf-ready')).toBe('true');
  });
});
