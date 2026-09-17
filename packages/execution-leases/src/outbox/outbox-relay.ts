import { Kafka, Producer } from 'kafkajs';
import { db, outboxEvents, isNull, asc, eq } from '@blackbox-x/db';
import { randomUUID } from 'node:crypto';
import type { OutboxEventData } from '../types.js';

export interface OutboxRelayOptions {
  kafkaBrokers: string[];
  topic?: string;
  clientId?: string;
}

export class OutboxRelay {
  private kafka: Kafka;
  private producer: Producer;
  private topic: string;
  private connected = false;

  constructor(options: OutboxRelayOptions) {
    this.topic = options.topic ?? 'system-events.v1';
    this.kafka = new Kafka({
      clientId: options.clientId ?? `outbox-relay-${randomUUID().slice(0, 8)}`,
      brokers: options.kafkaBrokers,
      retry: { retries: 5 },
    });
    this.producer = this.kafka.producer();
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.producer.connect();
    this.connected = true;
  }

  async queueEvent(params: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
    epoch?: number;
  }): Promise<OutboxEventData> {
    const id = `evt-${randomUUID()}`;
    const epoch = params.epoch ?? 1;
    const now = new Date();

    await db.insert(outboxEvents).values({
      id,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      aggregateVersion: epoch,
      eventType: params.eventType,
      payload: params.payload,
      createdAt: now,
      publishedAt: null,
    });

    return {
      id,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      eventType: params.eventType,
      payload: params.payload,
      epoch,
      status: 'PENDING',
      createdAt: now,
      publishedAt: null,
    };
  }

  async relayPendingEvents(limit = 50): Promise<number> {
    if (!this.connected) await this.connect();

    const pending = await db
      .select()
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(limit);

    if (pending.length === 0) return 0;

    for (const evt of pending) {
      await this.producer.send({
        topic: this.topic,
        messages: [
          {
            key: evt.aggregateId,
            value: JSON.stringify(evt.payload),
            headers: {
              'event-id': evt.id,
              'event-type': evt.eventType,
              'aggregate-type': evt.aggregateType,
              epoch: String(evt.aggregateVersion),
            },
          },
        ],
      });

      const now = new Date();
      await db
        .update(outboxEvents)
        .set({
          publishedAt: now,
        })
        .where(eq(outboxEvents.id, evt.id));
    }

    return pending.length;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.producer.disconnect();
    this.connected = false;
  }
}
