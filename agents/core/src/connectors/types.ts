/**
 * Connector type definitions. Per-type config shapes live here so the rest of
 * the codebase has one place to look when adding a new integration.
 *
 * The schema's `connectors.config_json` is opaque jsonb; these interfaces are
 * the contract callers honor when reading/writing those rows.
 */

import type { connectors } from "../db/schema.js";

export type ConnectorRow = typeof connectors.$inferSelect;

/** Atlassian Cloud REST API target. Token lives in the OS keychain (secret_ref). */
export interface JiraConfig {
  /** Base URL, no trailing slash. e.g. "https://mycorp.atlassian.net". */
  host: string;
  /** Login email used for HTTP basic auth alongside the API token. */
  email: string;
}

export type ConnectorType = "jira" | "github" | "slack" | "whatsapp";

export interface TestResult {
  ok: boolean;
  /** Short human-readable outcome — surfaced in the UI / CLI stdout. */
  message: string;
  /** Optional structured data (e.g. authenticated user identity). */
  data?: Record<string, unknown>;
}
