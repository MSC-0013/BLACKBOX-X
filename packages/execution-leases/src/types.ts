export type LeaseStatus = 'ACTIVE' | 'EXPIRED' | 'RELEASED';

export interface Lease {
  id: string;
  resourceId: string;
  holderId: string;
  epoch: number;
  status: LeaseStatus;
  expiresAt: Date;
  acquiredAt: Date;
  renewedAt: Date;
}

export type OutboxStatus = 'PENDING' | 'PUBLISHED' | 'FAILED';

export interface OutboxEventData {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  epoch: number;
  status: OutboxStatus;
  createdAt: Date;
  publishedAt?: Date | null;
}

export interface InboxEventData {
  id: string;
  eventId: string;
  consumerGroup: string;
  processedAt: Date;
}
