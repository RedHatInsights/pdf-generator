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

// manifestLocation must be a relative path or an absolute URL from allowed origins.
// Prevents javascript:, data:, and other dangerous URI schemes from being
// loaded by the headless browser.
const RELATIVE_MANIFEST_RE = /^\/(?![/\\])[^\s<>"\\]*\.json$/;

const defaultManifestOrigins = [
  'console.redhat.com',
  'console.stage.redhat.com',
];
const envManifestOrigins =
  process.env.MANIFEST_ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];
const manifestOrigins =
  envManifestOrigins.length > 0 ? envManifestOrigins : defaultManifestOrigins;

export const MANIFEST_ALLOWED_ORIGINS = new Set(manifestOrigins);
if (process.env.NODE_ENV !== 'production') {
  MANIFEST_ALLOWED_ORIGINS.add('localhost');
}

function isValidManifestLocation(manifestLocation: string): boolean {
  if (RELATIVE_MANIFEST_RE.test(manifestLocation)) {
    return true;
  }

  try {
    const url = new URL(manifestLocation);
    const isLocalhost = url.hostname === 'localhost';
    const protocolOk =
      url.protocol === 'https:' || (isLocalhost && url.protocol === 'http:');
    return protocolOk && MANIFEST_ALLOWED_ORIGINS.has(url.hostname);
  } catch {
    return false;
  }
}

// module must be a relative webpack module specifier, e.g. "./App".
const MODULE_RE = /^\.\/(?!.*\.\.)[\w/.-]+$/;

// scope must be a valid npm package name or identifier.
const SCOPE_RE = /^[A-Za-z0-9_@/-]+$/;

export type PayloadValidationError = { field: string; message: string };

export function validatePayload(
  payload: unknown,
): PayloadValidationError | null {
  if (
    payload === null ||
    payload === undefined ||
    typeof payload !== 'object'
  ) {
    return {
      field: 'payload',
      message: 'payload must be a non-null object',
    };
  }
  const p = payload as Record<string, unknown>;
  if (
    typeof p.manifestLocation !== 'string' ||
    !p.manifestLocation ||
    !isValidManifestLocation(p.manifestLocation)
  ) {
    return {
      field: 'manifestLocation',
      message:
        'manifestLocation must be a relative JSON path or an absolute https:// URL from allowed origins',
    };
  }
  if (typeof p.module !== 'string' || !p.module || !MODULE_RE.test(p.module)) {
    return {
      field: 'module',
      message: 'module must be a relative module path (e.g. "./App")',
    };
  }
  if (typeof p.scope !== 'string' || !p.scope || !SCOPE_RE.test(p.scope)) {
    return {
      field: 'scope',
      message: 'scope must be an alphanumeric identifier',
    };
  }
  return null;
}
