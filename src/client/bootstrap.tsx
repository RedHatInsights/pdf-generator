/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AppsConfig, getModule } from '@scalprum/core';
import ScalprumProvider, {
  ScalprumComponent,
  ScalprumComponentProps,
} from '@scalprum/react-core';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import { GeneratePayload } from '../common/types';
import {
  ServiceNames,
  IntegrationEndpointsMap,
} from '../integration/endpoints';
import { resolveInternalRouteKey } from '../common/integrationEndpoints';

import 'react/jsx-runtime';

declare global {
  interface Window {
    __initialState__: GeneratePayload;
    __endpoints__: IntegrationEndpointsMap;
    IS_PRODUCTION: boolean;
  }
}

const state = window.__initialState__;
if (typeof state.fetchDataParams === 'string') {
  state.fetchDataParams = JSON.parse(state.fetchDataParams);
}
if (typeof state.additionalData === 'string') {
  state.additionalData = JSON.parse(state.additionalData);
}

const isExplicitReadiness = state.renderReadiness === 'explicit-v1';
const rootElement = document.getElementById('root');

if (isExplicitReadiness && rootElement) {
  rootElement.setAttribute('data-pdf-readiness-contract', 'v1');
  rootElement.setAttribute('data-pdf-ready', 'false');
}

async function waitForFonts(timeoutMs = 10000): Promise<void> {
  await Promise.race([
    document.fonts.ready,
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Font loading timeout')), timeoutMs),
    ),
  ]).catch((err) => {
    console.warn('[crc-pdf-generator] Font wait failed, proceeding:', err);
  });
}

async function waitForImages(container: Element): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'));
  const pending = images.filter((img) => !img.complete);
  await Promise.all(
    pending.map((img) =>
      new Promise<void>((resolve) => {
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }).then(async () => {
        if (typeof img.decode === 'function') {
          await img.decode().catch(() => {});
        }
      }),
    ),
  );
}

function waitForTwoRAFs(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

async function runReadinessGates(container: Element): Promise<void> {
  (window as any).__fontTimestamp = Date.now();
  await waitForFonts();
  (window as any).__fontTimestamp = Date.now();
  await waitForImages(container);
  await waitForTwoRAFs();
}

type PdfReadyContextType = {
  onPdfReady: () => void;
};

const PdfReadyContext = createContext<PdfReadyContextType>({
  onPdfReady: () => {},
});

export function usePdfReady(): PdfReadyContextType {
  return useContext(PdfReadyContext);
}

const config: AppsConfig = {
  [state.scope]: {
    name: state.scope,
    manifestLocation: state.manifestLocation,
  },
};

type CreateAxiosRequestConfig = AxiosRequestConfig & {
  clowderDeploymentName?: string;
};

type CreateAxiosRequest = (
  service: ServiceNames,
  config: CreateAxiosRequestConfig,
) => Promise<unknown>;

const createAxiosRequest: CreateAxiosRequest = (service, config) => {
  const { clowderDeploymentName, ...axiosConfig } = config;
  const routeKey = resolveInternalRouteKey(
    service,
    window.__endpoints__,
    clowderDeploymentName,
  );

  if (window.IS_PRODUCTION && !routeKey) {
    const message = `createAxiosRequest: internal route for "${service}" not found${
      clowderDeploymentName
        ? ` (clowderDeploymentName: ${clowderDeploymentName})`
        : ''
    }. Known keys: ${Object.keys(window.__endpoints__).join(
      ', ',
    )}. For apps with multiple Clowder deployments pass clowderDeploymentName (e.g. manager-service).`;
    throw new Error(message);
  }

  if (!axiosConfig.url) {
    throw new Error('createAxiosRequest: URL is required!');
  }
  const resolvedKey = routeKey ?? service;
  axiosConfig.url = `/internal/${resolvedKey}${axiosConfig.url}`;
  return axios(axiosConfig)
    .then((response: AxiosResponse) => response.data)
    .catch((error) => {
      console.error(error);
      throw error;
    });
};

type FetchData = (
  createAsyncRequest: CreateAxiosRequest,
  options?: GeneratePayload['fetchDataParams'],
) => Promise<unknown>;

type AsyncState = {
  loading: boolean;
  error: unknown;
  data: unknown;
};

function FetchErrorFallback({ error }: { error?: unknown }) {
  let content = null;
  try {
    if (error instanceof Error) {
      content = <div>{error.message}</div>;
    } else if (typeof error === 'string') {
      content = <div>{error}</div>;
    } else if (
      typeof error === 'object' &&
      error !== null &&
      typeof (error as any).message === 'string'
    ) {
      content = <div>{(error as any).message}</div>;
    } else {
      content = <div>{JSON.stringify(error, null, 2)}</div>;
    }
  } catch {
    content = <div>Something went wrong</div>;
  }
  return <div id="crc-pdf-generator-err">{content}</div>;
}

const MetadataWrapper = () => {
  const [asyncState, setAsyncState] = useState<AsyncState>({
    loading: true,
    error: null,
    data: null,
  });

  const pdfReadyResolverRef = useRef<(() => void) | null>(null);
  const pdfReadyPromiseRef = useRef<Promise<void> | null>(null);

  if (isExplicitReadiness && !pdfReadyPromiseRef.current) {
    pdfReadyPromiseRef.current = new Promise<void>((resolve) => {
      pdfReadyResolverRef.current = resolve;
    });
  }

  const handlePdfReady = useCallback(() => {
    (window as any).__callbackTimestamp = Date.now();
    pdfReadyResolverRef.current?.();
  }, []);

  async function getFetchMetadata() {
    try {
      const fn = await getModule<FetchData | undefined>(
        state.scope,
        state.module,
        'fetchData',
      );
      const fetchParams = state.fetchDataParams;
      const fetchParamsRecord =
        fetchParams &&
        typeof fetchParams === 'object' &&
        !Array.isArray(fetchParams)
          ? fetchParams
          : undefined;
      console.log(
        `[crc-pdf-generator] after getModule(fetchData): ${JSON.stringify({
          module: state.module,
          importName: state.importName,
          hasFetchDataExport: Boolean(fn),
          fetchDataParamKeys: fetchParamsRecord
            ? Object.keys(fetchParamsRecord)
            : [],
          fetchDataParamsClowderDeploymentName:
            fetchParamsRecord?.clowderDeploymentName ??
            '(not on fetchDataParams)',
        })}`,
      );
      if (!fn) {
        setAsyncState({ loading: false, error: null, data: null });
        return;
      }
      const data = await fn(createAxiosRequest, state.fetchDataParams);

      setAsyncState({ loading: false, error: null, data });
    } catch (error) {
      setAsyncState({ loading: false, error, data: null });
    }
  }
  useEffect(() => {
    getFetchMetadata();
  }, []);

  useEffect(() => {
    if (!isExplicitReadiness || asyncState.loading || asyncState.error) return;

    let cancelled = false;
    (async () => {
      if (pdfReadyPromiseRef.current) {
        await pdfReadyPromiseRef.current;
      }
      if (cancelled) return;
      const container = document.getElementById('root');
      if (container) {
        await runReadinessGates(container);
        if (!cancelled) {
          (window as any).__readyTimestamp = Date.now();
          container.setAttribute('data-pdf-ready', 'true');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [asyncState.loading, asyncState.error]);

  const { error, loading, data } = asyncState;
  if (error) {
    return <FetchErrorFallback error={error} />;
  }

  if (loading) {
    return <div>Loading...</div>;
  }

  const props: ScalprumComponentProps<
    Record<string, any>,
    {
      asyncData: { data: unknown };
      additionalData: Record<string, unknown> | undefined;
      onPdfReady?: () => void;
    }
  > = {
    asyncData: { data },
    additionalData: state.additionalData,
    scope: state.scope,
    module: state.module,
    importName: state.importName,
    ErrorComponent: <FetchErrorFallback />,
    onPdfReady: isExplicitReadiness ? handlePdfReady : undefined,
  };
  return (
    <PdfReadyContext.Provider value={{ onPdfReady: handlePdfReady }}>
      {/* ensure CSS scope is applied */}
      <div className={state.scope}>
        <ScalprumComponent {...props} />
      </div>
    </PdfReadyContext.Provider>
  );
};

const App = () => {
  return (
    <ScalprumProvider
      config={config}
      pluginSDKOptions={{
        pluginLoaderOptions: {
          transformPluginManifest: (manifest) => {
            const newManifest = {
              ...manifest,
            };
            // Adjust the base URL to manifest location public path
            if (manifest.baseURL === 'auto') {
              const manifestLocation = config[manifest.name]?.manifestLocation;
              if (manifestLocation) {
                const fragments = state.manifestLocation.split('/');
                fragments.pop();
                const baseURL = fragments.join('/') + '/';
                newManifest.baseURL = baseURL;
                newManifest.loadScripts = manifest.loadScripts.map(
                  (script) => `${baseURL}${script}`,
                );
              }
            }
            return newManifest;
          },
        },
      }}
    >
      <MetadataWrapper />
    </ScalprumProvider>
  );
};

if (!rootElement) throw new Error('Root element not found');

const root = createRoot(rootElement);
root.render(<App />);
