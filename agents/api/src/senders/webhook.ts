/**
 * webhook sender — POSTs the event as JSON to a user-configured URL,
 * optionally HMAC-SHA256 signed if the channel has a secret. Receivers
 * verify the signature in `x-agents-signature` against the raw body.
 *
 * channel.configJson shape: { url: string, headers?: Record<string,string> }.
 * channel.secretRef        : optional. If present, plaintext is fetched and
 *                            used as the HMAC key.
 */

import { createHmac } from "node:crypto";
import { registerSender, type SenderFn } from "@agents/core";

interface WebhookConfig {
  url?: unknown;
  headers?: unknown;
}

const webhookSender: SenderFn = async (channel, args, secret) => {
  const cfg = (channel.configJson ?? {}) as WebhookConfig;
  if (typeof cfg.url !== "string" || !/^https?:\/\//.test(cfg.url)) {
    throw new Error(`webhook channel ${channel.id} has no valid URL`);
  }

  const body = JSON.stringify({
    event: args.event,
    title: args.title,
    body: args.body,
    subject: args.subjectRef,
    extra: args.extra,
    occurredAt: new Date().toISOString(),
  });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "agents-notifier/1",
  };
  if (cfg.headers && typeof cfg.headers === "object" && !Array.isArray(cfg.headers)) {
    for (const [k, v] of Object.entries(cfg.headers as Record<string, unknown>)) {
      if (typeof v === "string") headers[k] = v;
    }
  }
  if (secret) {
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    headers["x-agents-signature"] = `sha256=${sig}`;
  }

  const res = await fetch(cfg.url, { method: "POST", headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`webhook ${cfg.url} returned ${res.status}: ${text.slice(0, 200)}`);
  }
  return { status: res.status, url: cfg.url };
};

export function registerWebhookSender(): void {
  registerSender("webhook", webhookSender);
}
