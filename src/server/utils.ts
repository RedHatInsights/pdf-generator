import { apiLogger } from '../common/logging';
import { produceMessage } from '../common/kafka';
import { UPDATE_TOPIC } from '../browser/constants';
import PdfCache, { PDFComponent } from '../common/pdfCache';

const pdfCache = PdfCache.getInstance();

export const UpdateStatus = async (updateMessage: PDFComponent) => {
  pdfCache.addToCollection(updateMessage.collectionId, updateMessage);
  const collection = pdfCache.getCollection(updateMessage.collectionId);
  const messageWithLength = {
    ...updateMessage,
    expectedLength: collection?.expectedLength,
  };
  await produceMessage(UPDATE_TOPIC, messageWithLength)
    .then(() => {
      apiLogger.debug('Generating message sent');
    })
    .catch((error: unknown) => {
      apiLogger.error(`Kafka message not sent: ${error}`);
    });
  await pdfCache.verifyCollection(updateMessage.collectionId);
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

// manifestLocation must be a relative path or an absolute https:// URL.
// Prevents javascript:, data:, and other dangerous URI schemes from being
// loaded by the headless browser.
const MANIFEST_RE = /^(https:\/\/[^\s<>"]+|\/[^\s<>"]*\.json)$/;

// module must be a relative webpack module specifier, e.g. "./App".
const MODULE_RE = /^\.\/[A-Za-z0-9_/.-]+$/;

// scope must be a valid npm package name or identifier.
const SCOPE_RE = /^[A-Za-z0-9_@/-]+$/;

export type PayloadValidationError = { field: string; message: string };

export function validatePayload(payload: {
  manifestLocation: string;
  module: string;
  scope: string;
}): PayloadValidationError | null {
  if (
    !payload.manifestLocation ||
    !MANIFEST_RE.test(payload.manifestLocation)
  ) {
    return {
      field: 'manifestLocation',
      message:
        'manifestLocation must be a relative JSON path or an absolute https:// URL',
    };
  }
  if (!payload.module || !MODULE_RE.test(payload.module)) {
    return {
      field: 'module',
      message: 'module must be a relative module path (e.g. "./App")',
    };
  }
  if (!payload.scope || !SCOPE_RE.test(payload.scope)) {
    return {
      field: 'scope',
      message: 'scope must be an alphanumeric identifier',
    };
  }
  return null;
}
