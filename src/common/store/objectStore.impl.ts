import { apiLogger } from '../logging';
import config from '../config';
import { Readable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { readFile } from 'fs/promises';
import * as https from 'https';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { PDFStorageService } from './types';

const S3_MAX_RETRIES = parseInt(process.env.S3_MAX_RETRIES || '3', 10);
const S3_RETRY_BASE_DELAY_MS = parseInt(
  process.env.S3_RETRY_BASE_DELAY_MS || '1000',
  10,
);

/**
 * Determines whether an S3 error is transient and safe to retry.
 * Retries on 5xx server errors and known transient error codes.
 * Does NOT retry 4xx client errors (auth failures, bad requests, etc.).
 */
export function isTransientS3Error(error: unknown): boolean {
  if (error == null || typeof error !== 'object') {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = error as any;

  // Check HTTP status code — retry 5xx only
  const statusCode = err['$metadata']?.httpStatusCode;
  if (typeof statusCode === 'number' && statusCode >= 500) {
    return true;
  }

  // Check for known transient S3 error codes
  const transientCodes = [
    'InternalError',
    'InternalFailure',
    'ServiceUnavailable',
    'SlowDown',
    'RequestTimeout',
    'RequestTimeTooSkewed',
  ];
  if (typeof err.Code === 'string' && transientCodes.includes(err.Code)) {
    return true;
  }
  if (typeof err.name === 'string' && transientCodes.includes(err.name)) {
    return true;
  }

  // Check for network-level errors (connection reset, timeout, etc.)
  const networkCodes = ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'];
  if (typeof err.code === 'string' && networkCodes.includes(err.code)) {
    return true;
  }

  return false;
}

/**
 * Computes delay for a retry attempt using exponential backoff with jitter.
 * Jitter prevents thundering-herd when multiple uploads retry simultaneously.
 */
export function computeRetryDelay(
  attempt: number,
  baseDelayMs: number,
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelayMs;
  return exponentialDelay + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const StorageClient = () => {
  if (config?.objectStore.tls) {
    apiLogger.debug('aws config');
    return new S3Client({
      region: config?.objectStore.buckets[0].region,
      credentials: {
        accessKeyId: config?.objectStore.buckets[0].accessKey,
        secretAccessKey: config?.objectStore.buckets[0].secretKey,
      },
      maxAttempts: S3_MAX_RETRIES + 1,
      requestHandler: new NodeHttpHandler({
        requestTimeout: 60000,
        connectionTimeout: 60000,
        httpsAgent: new https.Agent({
          maxSockets: 500,
        }),
      }),
    });
  }
  apiLogger.debug('minio config');
  // endpoint and forcePathStyle are required to work with local minio
  // region is not populated by the config in eph so we'll use east-1
  return new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: config?.objectStore.buckets[0].accessKey,
      secretAccessKey: config?.objectStore.buckets[0].secretKey,
    },
    endpoint: `http://${config?.objectStore.hostname}:${config?.objectStore.port}`,
    forcePathStyle: true,
    maxAttempts: S3_MAX_RETRIES + 1,
    requestHandler: new NodeHttpHandler({
      requestTimeout: 60000,
      connectionTimeout: 60000,
      httpsAgent: new https.Agent({
        maxSockets: 500,
      }),
    }),
  });
};

export class ObjectStore implements PDFStorageService {
  private s3: S3Client;

  constructor() {
    this.s3 = StorageClient();
  }

  public async uploadPDF(id: string, path: string) {
    const bucket = config?.objectStore.buckets[0].name;
    apiLogger.debug(`${JSON.stringify(config?.objectStore)}`);
    const exists = await this.checkBucketExists(bucket);
    if (!exists) {
      await this.createBucket(bucket);
    }

    // Read the file into a Buffer so the SDK can retry automatically
    // (streams are consumed on first attempt and cannot be replayed)
    const fileBuffer = await readFile(path);

    const uploadParams = {
      Bucket: bucket,
      Key: `${id}.pdf`,
      Body: fileBuffer,
      ContentType: 'application/pdf',
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= S3_MAX_RETRIES; attempt++) {
      try {
        await this.s3.send(new PutObjectCommand(uploadParams));
        if (attempt > 0) {
          apiLogger.info(
            `S3 upload succeeded on attempt ${attempt + 1}/${S3_MAX_RETRIES + 1}: ${id}.pdf`,
          );
        }
        apiLogger.debug(`File uploaded successfully: ${id}.pdf`);
        return;
      } catch (error) {
        lastError = error;

        if (!isTransientS3Error(error)) {
          apiLogger.error(`S3 upload permanent error for ${id}.pdf: ${error}`);
          throw error;
        }

        if (attempt < S3_MAX_RETRIES) {
          const delay = computeRetryDelay(attempt, S3_RETRY_BASE_DELAY_MS);
          apiLogger.warning(
            `S3 upload transient error for ${id}.pdf (attempt ${attempt + 1}/${S3_MAX_RETRIES + 1}), retrying in ${Math.round(delay)}ms: ${error}`,
          );
          await sleep(delay);
        }
      }
    }

    apiLogger.error(
      `S3 upload failed after ${S3_MAX_RETRIES + 1} attempts for ${id}.pdf: ${lastError}`,
    );
    throw lastError;
  }

  public async downloadPDF(id: string) {
    const bucket = config?.objectStore.buckets[0].name;
    const exists = await this.checkBucketExists(bucket);
    if (!exists) {
      throw new Error(`No such bucket ${bucket}`);
    }
    const downloadParams = {
      Bucket: bucket,
      Key: `${id}.pdf`,
    };
    const response = await this.s3.send(new GetObjectCommand(downloadParams));
    if (!response.Body) {
      return;
    }
    return response.Body as Readable;
  }

  private checkBucketExists = async (bucket: string) => {
    const options = {
      Bucket: bucket,
    };

    try {
      await this.s3.send(new HeadBucketCommand(options));
      return true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error['$metadata']?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  };

  private createBucket = async (bucket: string) => {
    const command = new CreateBucketCommand({
      // The name of the bucket. Bucket names are unique and have several other constraints.
      // See https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html
      Bucket: bucket,
    });
    try {
      await this.s3.send(command);
    } catch (error) {
      throw new Error(`Error creating bucket: ${error}`);
    }
  };
}
