/**
 * Notifications — per-user channels + subscriptions + dispatcher.
 *
 * Flow: code that wants to notify calls `dispatchEvent({event, ownerId, subject})`.
 * The dispatcher fans out to every enabled subscription (event -> channel)
 * for that user. Each enabled channel has a registered sender keyed by kind;
 * the sender produces a result blob or throws. Either way the attempt lands
 * in `notification_deliveries` for the UI's debug log.
 *
 * Senders register at startup (e.g. consoleSender, webhookSender). Adding a
 * new sender (Slack, email, desktop) means: implement the function, call
 * `registerSender(kind, fn)`.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../db/client.js";
import { getByRef, getSecrets } from "../secrets/index.js";

export type NotificationChannel = typeof schema.notificationChannels.$inferSelect;
export type NotificationSubscription =
  typeof schema.notificationSubscriptions.$inferSelect;
export type NotificationDelivery =
  typeof schema.notificationDeliveries.$inferSelect;

export type NotificationEvent =
  | "run_succeeded"
  | "run_failed"
  | "approval_pending"
  | "approval_failed";

/** Payload handed to senders. Structured so future formatters can pull what they need. */
export interface DispatchArgs {
  ownerId: string;
  event: NotificationEvent;
  /** A short human-friendly label ("Run #42 of pr-reviewer failed"). */
  title: string;
  /** Optional longer body (markdown OK — webhook + slack render it). */
  body?: string;
  /** Stable reference to the originating row, for audit logging + dedup. */
  subjectRef: Record<string, unknown>;
  /** Additional structured fields available to the sender. */
  extra?: Record<string, unknown>;
}

export type SenderFn = (
  channel: NotificationChannel,
  args: DispatchArgs,
  /** Resolved plaintext secret if channel has a secret_ref, else null. */
  secret: string | null,
) => Promise<Record<string, unknown>>;

const senders = new Map<string, SenderFn>();

export function registerSender(kind: string, fn: SenderFn): void {
  senders.set(kind, fn);
}

export function listSenders(): string[] {
  return [...senders.keys()];
}

// ---------------------------------------------------------------------------
// Channel CRUD
// ---------------------------------------------------------------------------

export interface AddChannelArgs {
  ownerId: string;
  kind: string;
  displayName: string;
  configJson: Record<string, unknown>;
  /** Raw secret stored in keychain; only the ref persists in the DB. */
  secret?: string;
}

export async function addChannel(args: AddChannelArgs): Promise<NotificationChannel> {
  const db = getDb();
  const id = randomUUID();

  let secretRef: string | undefined;
  if (args.secret) {
    secretRef = await getSecrets().set(`notif-${args.kind}:${id}`, args.secret);
  }

  const [row] = await db
    .insert(schema.notificationChannels)
    .values({
      id,
      ownerId: args.ownerId,
      kind: args.kind,
      displayName: args.displayName,
      configJson: args.configJson,
      secretRef,
      enabled: true,
    })
    .returning();
  return row;
}

export async function listChannels(
  ownerId: string,
): Promise<NotificationChannel[]> {
  return getDb()
    .select()
    .from(schema.notificationChannels)
    .where(eq(schema.notificationChannels.ownerId, ownerId))
    .orderBy(schema.notificationChannels.displayName);
}

export async function getChannel(
  id: string,
): Promise<NotificationChannel | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.notificationChannels)
    .where(eq(schema.notificationChannels.id, id))
    .limit(1);
  return row;
}

export async function removeChannel(
  id: string,
  ownerId: string,
): Promise<boolean> {
  const db = getDb();
  const channel = await getChannel(id);
  if (!channel || channel.ownerId !== ownerId) return false;
  if (channel.secretRef) {
    await getSecrets().delete(channel.secretRef).catch(() => undefined);
  }
  await db
    .delete(schema.notificationChannels)
    .where(eq(schema.notificationChannels.id, id));
  return true;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export async function listSubscriptions(
  ownerId: string,
): Promise<NotificationSubscription[]> {
  return getDb()
    .select()
    .from(schema.notificationSubscriptions)
    .where(eq(schema.notificationSubscriptions.ownerId, ownerId));
}

export async function setSubscription(
  ownerId: string,
  event: NotificationEvent,
  channelId: string,
  enabled: boolean,
): Promise<NotificationSubscription> {
  const db = getDb();
  // Ensure the channel exists and belongs to the user.
  const channel = await getChannel(channelId);
  if (!channel || channel.ownerId !== ownerId) {
    throw new Error("channel not found");
  }

  const [existing] = await db
    .select()
    .from(schema.notificationSubscriptions)
    .where(
      and(
        eq(schema.notificationSubscriptions.ownerId, ownerId),
        eq(schema.notificationSubscriptions.event, event),
        eq(schema.notificationSubscriptions.channelId, channelId),
      ),
    )
    .limit(1);

  if (existing) {
    const [row] = await db
      .update(schema.notificationSubscriptions)
      .set({ enabled })
      .where(
        and(
          eq(schema.notificationSubscriptions.ownerId, ownerId),
          eq(schema.notificationSubscriptions.event, event),
          eq(schema.notificationSubscriptions.channelId, channelId),
        ),
      )
      .returning();
    return row;
  }
  const [row] = await db
    .insert(schema.notificationSubscriptions)
    .values({ ownerId, event, channelId, enabled })
    .returning();
  return row;
}

export async function removeSubscription(
  ownerId: string,
  event: NotificationEvent,
  channelId: string,
): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(schema.notificationSubscriptions)
    .where(
      and(
        eq(schema.notificationSubscriptions.ownerId, ownerId),
        eq(schema.notificationSubscriptions.event, event),
        eq(schema.notificationSubscriptions.channelId, channelId),
      ),
    )
    .returning({ channelId: schema.notificationSubscriptions.channelId });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------
// Deliveries (audit log)
// ---------------------------------------------------------------------------

export async function listDeliveries(
  ownerId: string,
  limit = 50,
): Promise<NotificationDelivery[]> {
  // Inner join channels so we can filter by owner.
  const db = getDb();
  const rows = await db
    .select({ d: schema.notificationDeliveries })
    .from(schema.notificationDeliveries)
    .innerJoin(
      schema.notificationChannels,
      eq(
        schema.notificationChannels.id,
        schema.notificationDeliveries.channelId,
      ),
    )
    .where(eq(schema.notificationChannels.ownerId, ownerId))
    .orderBy(desc(schema.notificationDeliveries.sentAt))
    .limit(limit);
  return rows.map((r) => r.d);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Fire `event` to every enabled subscribed channel for the user.
 * Returns the number of deliveries attempted (sent + failed). Never throws;
 * failures are captured in the deliveries log so the caller can keep going.
 */
export async function dispatchEvent(args: DispatchArgs): Promise<number> {
  const db = getDb();
  // Find all enabled (subscription + channel) pairs for this user+event.
  const rows = await db
    .select({ channel: schema.notificationChannels })
    .from(schema.notificationSubscriptions)
    .innerJoin(
      schema.notificationChannels,
      eq(
        schema.notificationChannels.id,
        schema.notificationSubscriptions.channelId,
      ),
    )
    .where(
      and(
        eq(schema.notificationSubscriptions.ownerId, args.ownerId),
        eq(schema.notificationSubscriptions.event, args.event),
        eq(schema.notificationSubscriptions.enabled, true),
        eq(schema.notificationChannels.enabled, true),
      ),
    );

  if (rows.length === 0) return 0;

  await Promise.all(
    rows.map(async ({ channel }) => {
      const sender = senders.get(channel.kind);
      if (!sender) {
        await db.insert(schema.notificationDeliveries).values({
          channelId: channel.id,
          event: args.event,
          subjectRef: args.subjectRef,
          status: "failed",
          error: `no sender registered for kind=${channel.kind}`,
        });
        return;
      }
      let secret: string | null = null;
      if (channel.secretRef) {
        secret = await getByRef(channel.secretRef).catch(() => null);
      }
      try {
        const result = await sender(channel, args, secret);
        await db.insert(schema.notificationDeliveries).values({
          channelId: channel.id,
          event: args.event,
          subjectRef: args.subjectRef,
          senderResult: result,
          status: "sent",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db.insert(schema.notificationDeliveries).values({
          channelId: channel.id,
          event: args.event,
          subjectRef: args.subjectRef,
          status: "failed",
          error: message,
        });
      }
    }),
  );
  return rows.length;
}
