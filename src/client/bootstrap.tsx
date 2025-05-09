/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AppsConfig, getModule } from '@scalprum/core';
import ScalprumProvider, {
  ScalprumComponent,
  ScalprumComponentProps,
} from '@scalprum/react-core';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GeneratePayload } from '../common/types';
import { ServiceNames, ServicesEndpoints } from '../integration/endpoints';

declare global {
  interface Window {
    __initialState__: GeneratePayload;
    __endpoints__: Partial<ServicesEndpoints>;
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

const config: AppsConfig = {
  [state.scope]: {
    name: state.scope,
    manifestLocation: state.manifestLocation,
  },
};

type CreateAxiosRequest = (
  service: ServiceNames,
  config: AxiosRequestConfig,
) => Promise<unknown>;

function createAxiosRequest(service: ServiceNames, config: AxiosRequestConfig) {
  if (window.IS_PRODUCTION && !window.__endpoints__[service]) {
    const message = `createAxiosRequest: Service ${service} not found! Available services: ${Object.keys(
      window.__endpoints__,
    ).join(', ')}.\n You might need to add service integration in the config.`;
    throw new Error(message);
  }

  if (!config.url) {
    throw new Error('createAxiosRequest: URL is required!');
  }
  config.url = `/internal/${service}${config.url}`;
  return axios(config)
    .then((response: AxiosResponse) => response.data)
    .catch((error) => {
      console.error(error);
      throw error;
    });
}

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
  async function getFetchMetadata() {
    try {
      const fn = await getModule<FetchData | undefined>(
        state.scope,
        state.module,
        'fetchData',
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
    }
  > = {
    asyncData: { data },
    additionalData: state.additionalData,
    scope: state.scope,
    module: state.module,
    importName: state.importName,
    ErrorComponent: <FetchErrorFallback />,
  };
  return (
    // ensure CSS scope is applied
    <div className={state.scope}>
      <ScalprumComponent {...props} />
    </div>
  );
};

const App = () => {
  return (
    <ScalprumProvider config={config}>
      <MetadataWrapper />
    </ScalprumProvider>
  );
};

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

const root = createRoot(rootElement);
root.render(<App />);
