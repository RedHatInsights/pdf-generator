import { apiLogger } from './logging';
import config from './config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'fs-extra';
import * as https from 'https';
import { NodeHttpHandler } from '@smithy/node-http-handler';

export const StorageClient = () => {
  if (config?.objectStore.tls) {
    apiLogger.debug('aws config');
    return new S3Client({
      region: config?.objectStore.buckets[0].region,
      credentials: {
        accessKeyId: config?.objectStore.buckets[0].accessKey,
        secretAccessKey: config?.objectStore.buckets[0].secretKey,
      },
      // TODO: Determine if this will be needed after more scale testing
      // The new node handler helps with some S3 timeout and network flakiness
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
    requestHandler: new NodeHttpHandler({
      requestTimeout: 60000,
      connectionTimeout: 60000,
      httpsAgent: new https.Agent({
        maxSockets: 500,
      }),
    }),
  });
};

const s3 = StorageClient();

const checkBucketExists = async (bucket: string) => {
  const options = {
    Bucket: bucket,
  };

  try {
    await s3.send(new HeadBucketCommand(options));
    return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error['$metadata']?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
};

const createBucket = async (bucket: string) => {
  const command = new CreateBucketCommand({
    // The name of the bucket. Bucket names are unique and have several other constraints.
    // See https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html
    Bucket: bucket,
  });
  try {
    await s3.send(command);
  } catch (error) {
    throw new Error(`Error creating bucket: ${error}`);
  }
};

export const uploadPDF = async (id: string, path: string) => {
  const bucket = config?.objectStore.buckets[0].name;
  apiLogger.debug(`${JSON.stringify(config?.objectStore)}`);
  const exists = await checkBucketExists(bucket);
  if (!exists) {
    await createBucket(bucket);
  }
  try {
    // Create a read stream for the PDF file
    const fileStream = createReadStream(path);

    // Define the parameters for the S3 upload
    const uploadParams = {
      Bucket: bucket,
      Key: `${id}.pdf`,
      Body: fileStream,
      ContentType: 'application/pdf',
    };

    // Upload the file to S3
    await s3.send(new PutObjectCommand(uploadParams));
    apiLogger.debug(`File uploaded successfully: ${`${id}.pdf`}`);
  } catch (error) {
    apiLogger.debug(`Error uploading file: ${error}`);
  }
};

// Fetches a PDF from the configured s3 bucket
export const downloadPDF = async (id: string) => {
  const bucket = config?.objectStore.buckets[0].name;
  const exists = await checkBucketExists(bucket);
  if (!exists) {
    apiLogger.debug(`Error downloading file: No such bucket ${bucket}`);
  }
  try {
    const downloadParams = {
      Bucket: bucket,
      Key: `${id}.pdf`,
    };
    const response = await s3.send(new GetObjectCommand(downloadParams));
    return response;
  } catch (error) {
    apiLogger.debug(`Error downloading file: ${error}`);
  }
};
