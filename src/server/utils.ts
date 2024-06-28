import { apiLogger } from '../common/logging';
import { produceMessage } from '../common/kafka';
import { UPDATE_TOPIC } from '../browser/constants';
import PdfCache, { PDFComponent } from '../common/pdfCache';

const pdfCache = PdfCache.getInstance();

export const UpdateStatus = async (updateMessage: PDFComponent) => {
  await produceMessage(UPDATE_TOPIC, updateMessage)
    .then(() => {
      apiLogger.debug('Generating message sent');
    })
    .catch((error: unknown) => {
      apiLogger.error(`Kafka message not sent: ${error}`);
    });
  pdfCache.addToCollection(updateMessage.collectionId, updateMessage);
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
      ''
    );
  }
  return value;
}

// Function to sanitize a Record<string, unknown>
export function sanitizeRecord(
  record: Record<string, unknown>
): Record<string, unknown> {
  const sanitizedRecord: Record<string, unknown> = {};
  Object.keys(record).forEach((key) => {
    sanitizedRecord[key] = sanitizeString(record[key]);
  });
  return sanitizedRecord;
}
