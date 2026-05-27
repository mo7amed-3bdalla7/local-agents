/**
 * slack_message executor — posts an approved Slack message via the owner's
 * Slack notification channel (so users only configure Slack once, under
 * Notifications, and it works for both alerts and approval actions).
 *
 * Payload: { text: string }. The webhook URL is pulled from the user's first
 * enabled notification_channels row with kind='slack'.
 */

import { eq } from "drizzle-orm";
import {
  getDb,
  registerExecutor,
  schema,
  type ExecutorFn,
} from "@agents/core";

interface SlackConfig {
  url?: unknown;
  channel?: unknown;
}

const slackMessageExecutor: ExecutorFn = async (action) => {
  const payload = action.payload as { text?: unknown };
  const text = typeof payload.text === "string" ? payload.text : "";
  if (!text.trim()) {
    throw new Error("payload.text must be a non-empty string");
  }
  if (!action.ownerId) {
    throw new Error("action has no owner — cannot resolve a slack channel");
  }

  const db = getDb();
  const channels = await db
    .select()
    .from(schema.notificationChannels)
    .where(eq(schema.notificationChannels.ownerId, action.ownerId));
  const slack = channels.find((c) => c.kind === "slack" && c.enabled);
  if (!slack) {
    throw new Error(
      "No enabled 'slack' notification channel — add one under Notifications first.",
    );
  }

  const cfg = (slack.configJson ?? {}) as SlackConfig;
  if (typeof cfg.url !== "string" || !cfg.url.startsWith("https://hooks.slack.com/")) {
    throw new Error(`slack channel ${slack.id} has no valid webhook URL`);
  }

  const body: Record<string, unknown> = { text };
  if (typeof cfg.channel === "string") body.channel = cfg.channel;

  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`slack webhook ${res.status}: ${txt.slice(0, 200)}`);
  }
  return { channelId: slack.id, status: res.status };
};

export function registerSlackMessageExecutor(): void {
  registerExecutor("slack_message", slackMessageExecutor);
}
