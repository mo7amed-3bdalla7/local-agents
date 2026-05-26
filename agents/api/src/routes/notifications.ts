/**
 * /api/notifications/* — channels, subscriptions, deliveries.
 *
 * Channels and subscriptions are owner-scoped. Test endpoint fires a synthetic
 * event so users can validate a new channel before subscribing it.
 */

import { Hono } from "hono";
import {
  addChannel,
  dispatchEvent,
  getChannel,
  listChannels,
  listDeliveries,
  listSenders,
  listSubscriptions,
  removeChannel,
  removeSubscription,
  setSubscription,
  type NotificationEvent,
} from "@agents/core";
import { isUuid } from "../util.js";
import { currentUserId } from "../auth-util.js";

const ALL_EVENTS: NotificationEvent[] = [
  "run_succeeded",
  "run_failed",
  "approval_pending",
  "approval_failed",
];

function isEvent(s: unknown): s is NotificationEvent {
  return typeof s === "string" && ALL_EVENTS.includes(s as NotificationEvent);
}

export const notificationsRouter = new Hono();

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

notificationsRouter.get("/channels", async (c) => {
  const rows = await listChannels(currentUserId(c));
  return c.json({ channels: rows, senders: listSenders() });
});

notificationsRouter.post("/channels", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const kind = typeof body.kind === "string" ? body.kind : "";
  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!kind) return c.json({ error: "invalid_kind" }, 400);
  if (!displayName) return c.json({ error: "invalid_display_name" }, 400);

  const cfg =
    body.configJson &&
    typeof body.configJson === "object" &&
    !Array.isArray(body.configJson)
      ? (body.configJson as Record<string, unknown>)
      : {};
  const secret = typeof body.secret === "string" ? body.secret : undefined;

  try {
    const row = await addChannel({
      ownerId: currentUserId(c),
      kind,
      displayName,
      configJson: cfg,
      secret,
    });
    return c.json({ channel: row }, 201);
  } catch (err) {
    return c.json(
      {
        error: "create_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

notificationsRouter.delete("/channels/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const ok = await removeChannel(id, currentUserId(c));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});

notificationsRouter.post("/channels/:id/test", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const userId = currentUserId(c);
  const channel = await getChannel(id);
  if (!channel || channel.ownerId !== userId) {
    return c.json({ error: "not_found" }, 404);
  }
  // Dispatch a synthetic event narrowly subscribed *just for this test* would
  // require temp subscriptions. Easier: call the sender registry directly by
  // shimming a subscription. We do that by manually targeting this channel
  // through dispatchEvent + a one-shot subscription.
  //
  // To avoid polluting the user's subscriptions, just upsert + roll back.
  await setSubscription(userId, "run_succeeded", id, true);
  try {
    await dispatchEvent({
      ownerId: userId,
      event: "run_succeeded",
      title: "Test notification",
      body: "If you can see this, the channel works.",
      subjectRef: { kind: "test", channelId: id },
    });
  } finally {
    await removeSubscription(userId, "run_succeeded", id);
  }
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

notificationsRouter.get("/subscriptions", async (c) => {
  const rows = await listSubscriptions(currentUserId(c));
  return c.json({ subscriptions: rows, events: ALL_EVENTS });
});

notificationsRouter.put("/subscriptions", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const event = body.event;
  const channelId = body.channelId;
  const enabled = body.enabled !== false;
  if (!isEvent(event)) return c.json({ error: "invalid_event" }, 400);
  if (typeof channelId !== "string" || !isUuid(channelId)) {
    return c.json({ error: "invalid_channel_id" }, 400);
  }
  try {
    const row = await setSubscription(
      currentUserId(c),
      event,
      channelId,
      enabled,
    );
    return c.json({ subscription: row });
  } catch (err) {
    return c.json(
      {
        error: "set_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }
});

notificationsRouter.delete("/subscriptions", async (c) => {
  const event = c.req.query("event");
  const channelId = c.req.query("channelId");
  if (!isEvent(event)) return c.json({ error: "invalid_event" }, 400);
  if (!channelId || !isUuid(channelId)) {
    return c.json({ error: "invalid_channel_id" }, 400);
  }
  const ok = await removeSubscription(currentUserId(c), event, channelId);
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Deliveries (audit log)
// ---------------------------------------------------------------------------

notificationsRouter.get("/deliveries", async (c) => {
  const rows = await listDeliveries(currentUserId(c), 100);
  return c.json({ deliveries: rows });
});
