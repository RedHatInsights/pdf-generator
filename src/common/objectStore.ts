import { apiLogger } from './logging';
import config from './config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'fs-extra';

export const StorageClient = () => {
  if (config?.objectStore.tls) {
    apiLogger.debug('aws config');
    return new S3Client({
      region: config?.objectStore.buckets[0].region,
      credentials: {
        accessKeyId: config?.objectStore.buckets[0].accessKey,
        secretAccessKey: config?.objectStore.buckets[0].secretKey,
      },
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
  });
};

const s3 = StorageClient();

export const uploadPDF = async (id: string, path: string) => {
  const bucket = config?.objectStore.buckets[0].name;
  apiLogger.debug(`${JSON.stringify(config?.objectStore)}`);
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
    const response = await s3.send(new PutObjectCommand(uploadParams));
    apiLogger.debug(`File uploaded successfully: ${response}`);
  } catch (error) {
    apiLogger.debug(`Error uploading file: ${error}`);
  }
};

export const downloadPDF = async (id: string) => {
  const bucket = config?.objectStore.buckets[0].name;
  try {
    // Define the parameters for the S3 download
    const downloadParams = {
      Bucket: bucket,
      Key: `${id}.pdf`,
    };

    // Send the GetObjectCommand to S3
    const response = await s3.send(new GetObjectCommand(downloadParams));
    apiLogger.debug(`PDF found downloading as ${id}.pdf`);
    return response;
  } catch (error) {
    apiLogger.debug(`Error downloading file: ${error}`);
  }
};
