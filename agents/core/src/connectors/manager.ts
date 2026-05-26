/**
 * Connector registry — CRUD + per-type test dispatch.
 *
 * Secrets are stored in the OS keychain via @agents/core's SecretsAdapter; the
 * `connectors` row only holds a `secret_ref` pointer to the keychain entry.
 *
 * Test dispatch is hardcoded per type for now — easy to refactor into a
 * registration pattern once more than one connector exists.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../db/client.js";
import { getByRef, getSecrets } from "../secrets/index.js";
import { jiraTest } from "./jira/client.js";
import type { ConnectorRow, JiraConfig, TestResult } from "./types.js";

export type { ConnectorRow, JiraConfig, TestResult } from "./types.js";

export interface AddConnectorArgs {
  /** Connector module id — "jira" | "github" | "slack" | … */
  connectorType: string;
  /** Human label for the UI ("My Jira", "Acme Slack"). */
  displayName: string;
  /** Per-instance non-secret config (host, account). */
  configJson: Record<string, unknown>;
  /** Raw secret value. Stored in OS keychain; only the ref lives in the DB. */
  secret?: string;
  /** User who owns this connector. Null only for legacy/orphan rows. */
  ownerId?: string;
}

export async function addConnector(args: AddConnectorArgs): Promise<ConnectorRow> {
  const db = getDb();
  // Pre-allocate the id so the keychain key can embed it.
  const id = randomUUID();

  let secretRef: string | undefined;
  if (args.secret) {
    const key = `${args.connectorType}-token:${id}`;
    secretRef = await getSecrets().set(key, args.secret);
  }

  const [row] = await db
    .insert(schema.connectors)
    .values({
      id,
      connectorType: args.connectorType,
      displayName: args.displayName,
      configJson: args.configJson,
      secretRef,
      enabled: true,
      ownerId: args.ownerId,
    })
    .returning();
  return row;
}

export async function listConnectors(): Promise<ConnectorRow[]> {
  return getDb()
    .select()
    .from(schema.connectors)
    .orderBy(schema.connectors.displayName);
}

export async function getConnector(id: string): Promise<ConnectorRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.connectors)
    .where(eq(schema.connectors.id, id))
    .limit(1);
  return row;
}

/**
 * Find the first enabled connector of a given type. Used by the per-type CLIs
 * (e.g. `pnpm jira ...`) so the caller doesn't have to remember UUIDs.
 *
 * Agent-aware: when `AGENTS_AGENT_ID` is set in the environment (injected by
 * the worker for every agent run), only connectors that are both attached +
 * enabled for that agent are visible. Outside an agent context (manual shell,
 * CI script) the global first-enabled fallback applies.
 */
export async function getActiveConnector(
  connectorType: string,
): Promise<ConnectorRow | undefined> {
  const db = getDb();
  const agentId = process.env.AGENTS_AGENT_ID;

  if (agentId) {
    const [row] = await db
      .select({ c: schema.connectors })
      .from(schema.agentConnectors)
      .innerJoin(
        schema.connectors,
        eq(schema.connectors.id, schema.agentConnectors.connectorId),
      )
      .where(
        and(
          eq(schema.agentConnectors.agentId, agentId),
          eq(schema.agentConnectors.enabled, true),
          eq(schema.connectors.connectorType, connectorType),
          eq(schema.connectors.enabled, true),
        ),
      )
      .orderBy(schema.connectors.createdAt)
      .limit(1);
    return row?.c;
  }

  const [row] = await db
    .select()
    .from(schema.connectors)
    .where(
      and(
        eq(schema.connectors.connectorType, connectorType),
        eq(schema.connectors.enabled, true),
      ),
    )
    .orderBy(schema.connectors.createdAt)
    .limit(1);
  return row;
}

export async function removeConnector(id: string): Promise<boolean> {
  const db = getDb();
  const connector = await getConnector(id);
  if (!connector) return false;
  if (connector.secretRef) {
    await getSecrets().delete(connector.secretRef);
  }
  await db.delete(schema.connectors).where(eq(schema.connectors.id, id));
  return true;
}

/** Resolve a connector's plaintext secret via its secret_ref. */
export async function readSecret(connector: ConnectorRow): Promise<string | null> {
  if (!connector.secretRef) return null;
  return getByRef(connector.secretRef);
}

export async function testConnector(id: string): Promise<TestResult> {
  const connector = await getConnector(id);
  if (!connector) {
    return { ok: false, message: `connector ${id} not found` };
  }
  if (!connector.enabled) {
    return { ok: false, message: `connector ${connector.displayName} is disabled` };
  }
  const secret = await readSecret(connector);
  if (!secret) {
    return {
      ok: false,
      message: connector.secretRef
        ? `secret ${connector.secretRef} missing from keychain`
        : "connector has no secret_ref",
    };
  }

  switch (connector.connectorType) {
    case "jira":
      return jiraTest({
        config: connector.configJson as unknown as JiraConfig,
        token: secret,
      });
    default:
      return {
        ok: false,
        message: `no tester registered for connector type "${connector.connectorType}"`,
      };
  }
}
