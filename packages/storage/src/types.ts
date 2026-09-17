export interface StorageConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region?: string;
  bucket?: string;
  forcePathStyle?: boolean;
}

export interface StoredArtifactRecord {
  id: string;
  tenantId: string;
  bucketName: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256Checksum: string;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface UploadArtifactParams {
  tenantId: string;
  objectKey: string;
  content: Buffer | string;
  contentType?: string;
  metadata?: Record<string, unknown>;
}
