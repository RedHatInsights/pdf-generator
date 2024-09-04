import PDFMerger from 'pdf-merger-js';
import { promisify } from 'util';
import { apiLogger } from './logging';
import config from './config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { createReadStream, ensureDirSync, writeFile } from 'fs-extra';
import PdfCache from './pdfCache';

const asyncWriteFile = promisify(writeFile);

const getFileOrderFromPath = (filepath: string): number => {
  const stems = filepath.split('/');
  const orderNumber = stems[stems.length - 1].replace('.pdf', '');
  return parseInt(orderNumber, 10);
};

const filepathSort = (a: string, b: string) => {
  return getFileOrderFromPath(a) - getFileOrderFromPath(b);
};

export const StorageClient = () => {
  if (config?.objectStore.tls) {
    apiLogger.debug('aws config');
    return new S3Client({
      region: config?.objectStore.buckets[0].region,
      credentials: {
        accessKeyId: config?.objectStore.buckets[0].accessKey,
        secretAccessKey: config?.objectStore.buckets[0].secretKey,
      },
      requestHandler: {
        requestTimeout: 60000,
        httpsAgent: {
          maxSockets: 500,
        },
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
    requestHandler: {
      requestTimeout: 60000,
      httpsAgent: {
        maxSockets: 500,
      },
    },
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

// TODO: Large PDFs take too long to merge on the fly
// Merge them before they're requested over the network
export const downloadPDF = async (id: string) => {
  const bucket = config?.objectStore.buckets[0].name;
  const collection = PdfCache.getInstance().getCollection(id);
  if (!collection) {
    apiLogger.debug(`No collection found for ${id}`);
    return '';
  }
  const components = collection.components.map(
    (component) => `${component.componentId}.pdf`
  );
  apiLogger.debug(components);
  const tmpdir = `/tmp/${id}-components/*`;
  ensureDirSync(tmpdir);
  try {
    // Define the parameters for the S3 download
    const tasks = await Promise.all(
      components.map((component) => {
        const downloadParams = {
          Bucket: bucket,
          Key: component,
        };
        return s3.send(new GetObjectCommand(downloadParams));
      })
    );

    // Send the GetObjectCommand to S3
    const fragments = await Promise.all(tasks);
    const fragmentNames: string[] = [];
    // Since these are indexed, we know the order and can sort later
    const writeTasks = fragments.map((fragment, index) => {
      return new Promise<void>((resolve, reject) => {
        const fragmentName = `${tmpdir}/${index}.pdf`;
        fragment.Body?.transformToByteArray()
          .then((data) => {
            return asyncWriteFile(fragmentName, data);
          })
          .then(() => {
            fragmentNames.push(fragmentName);
            resolve();
          })
          .catch((error) => {
            reject(error);
          });
      });
    });

    await Promise.all(writeTasks);
    const merger = new PDFMerger();

    // Ensure order of files before merging
    fragmentNames.sort(filepathSort);
    // Don't use a Promise.all() to ensure order is deterministic
    for (const file of fragmentNames) {
      await merger.add(file);
    }
    const buffer = await merger.saveAsBuffer();

    apiLogger.debug(`PDF found downloading as ${id}.pdf`);
    return buffer;
  } catch (error) {
    apiLogger.debug(`Error downloading file: ${error}`);
    return '';
  }
};
