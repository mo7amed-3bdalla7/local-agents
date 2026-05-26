/**
 * Webhook triggers. Each registered webhook lives at `/api/triggers/<path>`
 * (default path = agent name). A single Hono route in server.ts looks up the
 * path in an in-memory map and dispatches; this module owns the map.
 *
 * Supports HMAC-SHA256 signature verification via the trigger's `secret` field.
 * Sender must include the hex digest as `sha256=<hex>` in either `X-Signature`
 * or `X-Hub-Signature-256` (GitHub-style).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { logger, type TriggerContext, type WebhookTrigger } from "@agents/sdk";
import { enqueueRun } from "./dispatch.js";

interface WebhookRoute {
  agentName: string;
  trigger: WebhookTrigger;
}

const routes = new Map<string, WebhookRoute>();

interface AgentWebhooks {
  name: string;
  triggers: WebhookTrigger[];
}

export function registerWebhookTriggers(agents: AgentWebhooks[]): number {
  let count = 0;
  for (const agent of agents) {
    for (const trigger of agent.triggers) {
      const path = trigger.path ?? agent.name;
      const existing = routes.get(path);
      if (existing) {
        logger.error("Webhook path collision — ignoring", {
          path,
          existing: existing.agentName,
          conflict: agent.name,
        });
        continue;
      }
      routes.set(path, { agentName: agent.name, trigger });
      logger.info("Webhook trigger registered", {
        agent: agent.name,
        path: `/api/triggers/${path}`,
        requiresSignature: Boolean(trigger.secret),
        passBody: Boolean(trigger.passBody),
      });
      count++;
    }
  }
  return count;
}

export function clearWebhookRoutes(): void {
  routes.clear();
}

export interface WebhookResponse {
  status: 202 | 400 | 401 | 404;
  body: Record<string, unknown>;
}

/**
 * Dispatch a webhook request to its registered agent. Caller passes in the
 * raw body (string) so HMAC can be verified before JSON.parse; passes the
 * signature header(s) for verification.
 */
export async function dispatchWebhook(opts: {
  path: string;
  rawBody: string;
  signatureHeader?: string;
}): Promise<WebhookResponse> {
  const route = routes.get(opts.path);
  if (!route) {
    return {
      status: 404,
      body: { error: "no_webhook_for_path", path: opts.path },
    };
  }

  if (route.trigger.secret) {
    if (!opts.signatureHeader) {
      return { status: 401, body: { error: "missing_signature" } };
    }
    const expected =
      "sha256=" +
      createHmac("sha256", route.trigger.secret)
        .update(opts.rawBody)
        .digest("hex");
    const got = opts.signatureHeader;
    const ok =
      got.length === expected.length &&
      timingSafeEqual(Buffer.from(got), Buffer.from(expected));
    if (!ok) {
      return { status: 401, body: { error: "bad_signature" } };
    }
  }

  let webhookBody: unknown;
  if (route.trigger.passBody) {
    try {
      webhookBody = opts.rawBody ? JSON.parse(opts.rawBody) : null;
    } catch {
      webhookBody = opts.rawBody;
    }
  }

  const ctx: TriggerContext = {
    triggerType: "webhook",
    triggeredAt: new Date().toISOString(),
    webhookBody,
    meta: { path: opts.path },
  };

  const runId = await enqueueRun(route.agentName, ctx);
  if (runId === undefined) {
    return {
      status: 404,
      body: { error: "agent not enqueuable" },
    };
  }
  return {
    status: 202,
    body: { runId, agentName: route.agentName },
  };
}
