import * as Minio from 'minio';
import { apiLogger } from './logging';
import config from './config';

const minioClient = new Minio.Client({
  endPoint: config?.objectStore.hostname,
  port: config?.objectStore.port,
  useSSL: config?.objectStore.tls,
  accessKey: config?.objectStore.accessKey,
  secretKey: config?.objectStore.secretKey,
});

export const uploadPDF = async (id: string, path: string) => {
  const bucket = config?.objectStore.buckets[0].name;
  apiLogger.debug(config?.objectStore);
  try {
    const exists = await minioClient.bucketExists(bucket);
    if (!exists) {
      await minioClient.makeBucket(bucket, 'us-east-1');
    }
    const metadata = {
      'Content-Type': 'application/pdf',
    };
    await minioClient.fPutObject(bucket, `${id}.pdf`, path, metadata);
    apiLogger.debug(`PDF uploaded to ${bucket} as ${id}.pdf`);
  } catch (error: unknown) {
    apiLogger.debug(`${error}`);
  }
};

export const downloadPDF = async (id: string) => {
  const bucket = config?.objectStore.buckets[0].name;
  try {
    const stream = await minioClient.getObject(bucket, `${id}.pdf`);
    apiLogger.debug(`PDF found downloading as ${id}.pdf`);
    return stream;
  } catch (error: unknown) {
    apiLogger.debug(`${error}`);
  }
};
