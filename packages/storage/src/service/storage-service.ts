import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { db, storedArtifacts, eq } from '@blackbox-x/db';
import type { StorageConfig, StoredArtifactRecord, UploadArtifactParams } from '../types.js';

export class StorageService {
  private s3: S3Client;
  readonly defaultBucket: string;

  constructor(config: StorageConfig) {
    this.defaultBucket = config.bucket ?? 'blackbox-artifacts';
    this.s3 = new S3Client({
      endpoint: config.endpoint,
      region: config.region ?? 'us-east-1',
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: config.forcePathStyle ?? true,
    });
  }

  async ensureBucket(bucketName: string = this.defaultBucket): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: bucketName }));
      } catch (err: unknown) {
        const e = err as { name?: string };
        if (e.name !== 'BucketAlreadyOwnedByYou' && e.name !== 'BucketAlreadyExists') {
          throw err;
        }
      }
    }
  }

  async uploadArtifact(params: UploadArtifactParams): Promise<StoredArtifactRecord> {
    const bucket = this.defaultBucket;
    await this.ensureBucket(bucket);

    const buffer = typeof params.content === 'string' ? Buffer.from(params.content, 'utf-8') : params.content;
    const sha256Checksum = createHash('sha256').update(buffer).digest('hex');
    const contentType = params.contentType ?? 'application/octet-stream';
    const sizeBytes = buffer.length;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: params.objectKey,
        Body: buffer,
        ContentType: contentType,
        Metadata: {
          'tenant-id': params.tenantId,
          sha256: sha256Checksum,
        },
      }),
    );

    const id = `art-${randomUUID()}`;
    const now = new Date();

    await db.insert(storedArtifacts).values({
      id,
      tenantId: params.tenantId,
      bucketName: bucket,
      objectKey: params.objectKey,
      contentType,
      sizeBytes,
      sha256Checksum,
      metadata: params.metadata ?? null,
      createdAt: now,
    });

    return {
      id,
      tenantId: params.tenantId,
      bucketName: bucket,
      objectKey: params.objectKey,
      contentType,
      sizeBytes,
      sha256Checksum,
      metadata: params.metadata,
      createdAt: now,
    };
  }

  async downloadArtifact(objectKey: string): Promise<Buffer> {
    const bucket = this.defaultBucket;
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      }),
    );

    if (!response.Body) {
      throw new Error(`Object ${objectKey} returned empty body`);
    }

    const byteArray = await response.Body.transformToByteArray();
    return Buffer.from(byteArray);
  }

  async verifyArtifactIntegrity(
    objectKey: string,
  ): Promise<{ valid: boolean; expectedSha: string; actualSha: string }> {
    const [record] = await db
      .select()
      .from(storedArtifacts)
      .where(eq(storedArtifacts.objectKey, objectKey));

    if (!record) {
      throw new Error(`Artifact record not found in database for key: ${objectKey}`);
    }

    const downloaded = await this.downloadArtifact(objectKey);
    const actualSha = createHash('sha256').update(downloaded).digest('hex');
    const valid = actualSha === record.sha256Checksum;

    return {
      valid,
      expectedSha: record.sha256Checksum,
      actualSha,
    };
  }

  async deleteArtifact(objectKey: string): Promise<void> {
    const bucket = this.defaultBucket;
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      }),
    );

    await db.delete(storedArtifacts).where(eq(storedArtifacts.objectKey, objectKey));
  }
}
