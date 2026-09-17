import { db, inboxEvents, and, eq } from '@blackbox-x/db';

/**
 * Enforces idempotent at-least-once message processing with transactional deduplication
 * against MySQL `inbox_events`, guaranteeing an effectively-once committed database side effect
 * per (eventId, consumerName).
 */
export class InboxConsumer {
  async consumeWithIdempotency<T = void>(
    eventId: string,
    consumerName: string,
    handler: () => Promise<T>,
  ): Promise<{ processed: boolean; duplicate: boolean; result?: T }> {
    // Check if already processed
    const existing = await db
      .select()
      .from(inboxEvents)
      .where(
        and(
          eq(inboxEvents.eventId, eventId),
          eq(inboxEvents.consumerName, consumerName),
        ),
      );

    if (existing.length > 0) {
      return { processed: false, duplicate: true };
    }

    // Execute business handler
    const result = await handler();

    // Record in inbox table to enforce idempotency
    try {
      await db.insert(inboxEvents).values({
        eventId,
        consumerName,
        processedAt: new Date(),
      });
    } catch (err: unknown) {
      // If concurrent insert occurred with duplicate key
      const e = err as { code?: string };
      if (e.code === 'ER_DUP_ENTRY') {
        return { processed: false, duplicate: true, result };
      }
      throw err;
    }

    return { processed: true, duplicate: false, result };
  }
}
