/* eslint-disable @typescript-eslint/no-unsafe-return */
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import pAll from 'p-all';
import httpContext from 'express-http-context';
import config from '../common/config';
import { apiLogger } from '../common/logging';
import { produceMessage } from '../common/kafka';
import { UPDATE_TOPIC } from '../browser/constants';
import PdfCache, { PDFComponent } from '../common/pdfCache';

const pdfCache = PdfCache.getInstance();

export const UpdateStatus = async (updateMessage: PDFComponent) => {
  pdfCache.addToCollection(updateMessage.collectionId, updateMessage);
  await produceMessage(UPDATE_TOPIC, updateMessage)
    .then(() => {
      apiLogger.debug('Generating message sent');
    })
    .catch((error: unknown) => {
      apiLogger.error(`Kafka message not sent: ${error}`);
    });
  pdfCache.verifyCollection(updateMessage.collectionId);
};

export const isValidPageResponse = (code: number) => {
  if (code >= 200 && code < 400) {
    return true;
  }
  return false;
};

export function sanitizeString(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      '',
    );
  }
  return value;
}

// Function to sanitize a Record<string, unknown>
export function sanitizeRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const sanitizedRecord: Record<string, unknown> = {};
  Object.keys(record).forEach((key) => {
    sanitizedRecord[key] = sanitizeString(record[key]);
  });
  return sanitizedRecord;
}

export const getAuthenticationAndIdentity = () => ({
  authCookie: httpContext.get(config.JWT_COOKIE_NAME),
  authHeader:
    httpContext.get(config.AUTHORIZATION_CONTEXT_KEY) || process.env.MOCK_TOKEN,
  identity: httpContext.get(config?.IDENTITY_HEADER_KEY),
});

export const getAxiosRequest = (
  service: string,
  requestConfig: AxiosRequestConfig,
) => {
  if (!requestConfig.url) {
    throw new Error('createAxiosRequest: URL is required!');
  }

  requestConfig.url = `http://localhost:8000/internal/${service}${requestConfig.url}`;

  const { identity, authHeader } = getAuthenticationAndIdentity();
  const headers = {
    ...(identity ? { 'x-rh-identity': identity } : {}),
    ...(authHeader ? { Authorization: authHeader } : {}),
  };

  return axios({
    ...requestConfig,
    headers,
  })
    .then((response: AxiosResponse) => response.data)
    .catch((error) => {
      console.error(error);
      throw error;
    });
};

const getServiceRequests = async (
  service: string,
  serviceRequests: Record<string, AxiosRequestConfig>,
): Promise<Record<string, AxiosResponse>> => {
  const requests = Object.entries(serviceRequests).map(
    ([request, config]) =>
      async () => [request, await getAxiosRequest(service, config)],
  );
  const responses = await pAll(requests, {
    concurrency: 2,
  });

  return responses.reduce((ret, [key, response]) => {
    return {
      ...ret,
      [key]: response,
    };
  }, {});
};

export const getRequests = async (
  requests: Record<string, Record<string, AxiosRequestConfig>>,
): Promise<Record<string, Record<string, AxiosResponse>>> => {
  const servicesResults: Record<string, Record<string, AxiosResponse>> = {};

  for (const [service, serviceRequests] of Object.entries(requests)) {
    servicesResults[service] = await getServiceRequests(
      service,
      serviceRequests,
    );
  }

  return servicesResults;
};
