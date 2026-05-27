/**
 * slack sender — POSTs to a Slack incoming webhook URL.
 *
 * channel.configJson.url is required (https://hooks.slack.com/services/...).
 * The body is shaped to Slack's expected `{text, blocks}` schema instead of
 * our internal event shape.
 */

import { registerSender, type SenderFn } from "@agents/core";

interface SlackConfig {
  url?: unknown;
  /** Optional channel override; the webhook usually has a default. */
  channel?: unknown;
}

const slackSender: SenderFn = async (channel, args) => {
  const cfg = (channel.configJson ?? {}) as SlackConfig;
  if (typeof cfg.url !== "string" || !cfg.url.startsWith("https://hooks.slack.com/")) {
    throw new Error(
      `slack channel ${channel.id} has no valid hooks.slack.com URL`,
    );
  }

  const text = args.body ? `*${args.title}*\n${args.body}` : `*${args.title}*`;
  const slackBody: Record<string, unknown> = { text };
  if (typeof cfg.channel === "string") slackBody.channel = cfg.channel;

  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(slackBody),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`slack webhook ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return { status: res.status };
};

export function registerSlackSender(): void {
  registerSender("slack", slackSender);
}
