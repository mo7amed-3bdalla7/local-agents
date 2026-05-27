/**
 * Command implementations. Each takes a parsed-arg object and returns a
 * promise that resolves with exit code 0 or throws ApiError / Error.
 */

import pc from "picocolors";
import { apiRequest, ApiError, streamSse } from "./http.js";
import { loadConfig, saveConfig } from "./config.js";

interface AgentSummary {
  id: string;
  name: string;
  description: string;
  source: "file" | "db";
  enabled: boolean;
  updatedAt: string;
}

interface RunSummary {
  id: number;
  agentId: string;
  agentName?: string | null;
  sessionId: string | null;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

interface SessionSummary {
  id: string;
  agentId: string;
  agentName?: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
}

interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(s: string): string {
  switch (s) {
    case "success":
    case "completed":
    case "sent":
    case "executed":
      return pc.green(s);
    case "failure":
    case "failed":
    case "timeout":
      return pc.red(s);
    case "aborted":
    case "rejected":
    case "revoked":
      return pc.gray(s);
    case "active":
    case "pending":
    case "approved":
      return pc.cyan(s);
    default:
      return s;
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString();
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

function printTable(headers: string[], rows: string[][]): void {
  if (rows.length === 0) {
    console.log(pc.dim("(none)"));
    return;
  }
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i] ?? "").length)),
  );
  const sep = "  ";
  console.log(
    headers.map((h, i) => pc.bold(pad(h, widths[i]))).join(sep),
  );
  for (const row of rows) {
    console.log(
      row.map((cell, i) => padAnsi(cell ?? "", widths[i])).join(sep),
    );
  }
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}
function padAnsi(s: string, w: number): string {
  const visible = stripAnsi(s).length;
  return visible >= w ? s : s + " ".repeat(w - visible);
}
function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, "");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function cmdLogin(opts: {
  api?: string;
  token?: string;
}): Promise<void> {
  const existing = loadConfig();
  const api = opts.api ?? existing.api;
  const token = opts.token;
  if (!token) {
    throw new Error(
      "--token agt_... is required. Mint one at /tokens in the dashboard.",
    );
  }
  if (!token.startsWith("agt_")) {
    throw new Error("Token must start with 'agt_'");
  }
  // Validate against the server before saving.
  const probeCfg = { api, token };
  // Temporarily set env to validate.
  process.env.AGENTS_API = api;
  process.env.AGENTS_TOKEN = token;
  await apiRequest<{ agents: AgentSummary[] }>("/api/agents");
  delete process.env.AGENTS_API;
  delete process.env.AGENTS_TOKEN;

  saveConfig(probeCfg);
  console.log(pc.green("✓"), `Logged in. API: ${api}`);
}

export async function cmdLogout(): Promise<void> {
  const cfg = loadConfig();
  saveConfig({ api: cfg.api });
  console.log(pc.green("✓"), "Logged out (token removed from config).");
}

export async function cmdWhoami(): Promise<void> {
  const { user } = await apiRequest<{ user: { email: string; name: string } }>(
    "/api/auth/me",
  );
  const cfg = loadConfig();
  console.log(`${user.name} <${user.email}>`);
  console.log(pc.dim(`API: ${cfg.api}`));
}

export async function cmdAgentsList(): Promise<void> {
  const { agents } = await apiRequest<{ agents: AgentSummary[] }>(
    "/api/agents",
  );
  printTable(
    ["NAME", "SOURCE", "ENABLED", "DESCRIPTION"],
    agents.map((a) => [
      a.name,
      pc.dim(a.source),
      a.enabled ? pc.green("yes") : pc.red("no"),
      a.description.slice(0, 60),
    ]),
  );
}

export async function cmdAgentsRun(name: string): Promise<void> {
  const agent = await resolveAgentByName(name);
  const result = await apiRequest<{ runId: number; status: string }>(
    `/api/agents/${agent.id}/run`,
    { method: "POST" },
  );
  console.log(
    pc.green("✓"),
    `Run #${result.runId} enqueued (${statusColor(result.status)}).`,
  );
  console.log(pc.dim(`Tail: agents runs tail ${result.runId}`));
}

export async function cmdAgentsAbort(runId: string): Promise<void> {
  const id = Number(runId);
  if (!Number.isFinite(id)) throw new Error(`Invalid run id: ${runId}`);
  const result = await apiRequest<{ status: string; method: string }>(
    `/api/runs/${id}/abort`,
    { method: "POST" },
  );
  console.log(
    pc.green("✓"),
    `Abort issued — status now ${statusColor(result.status)} (${result.method}).`,
  );
}

export async function cmdRunsList(opts: {
  agent?: string;
  status?: string;
  limit?: number;
}): Promise<void> {
  const params = new URLSearchParams();
  if (opts.agent) {
    const a = await resolveAgentByName(opts.agent);
    params.set("agentId", a.id);
  }
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  let runs = (
    await apiRequest<{ runs: RunSummary[] }>(`/api/runs${qs ? `?${qs}` : ""}`)
  ).runs;

  if (opts.status) {
    const allowed = new Set(opts.status.split(",").map((s) => s.trim()));
    runs = runs.filter((r) => allowed.has(r.status));
  }

  printTable(
    ["ID", "AGENT", "STATUS", "STARTED", "DURATION", "ERROR"],
    runs.map((r) => [
      String(r.id),
      r.agentName ?? "-",
      statusColor(r.status),
      fmtDate(r.startedAt ?? r.createdAt),
      fmtDuration(r.durationMs),
      r.error ? r.error.slice(0, 50) : "",
    ]),
  );
}

export async function cmdRunsTail(runIdStr: string): Promise<void> {
  const runId = Number(runIdStr);
  if (!Number.isFinite(runId)) throw new Error(`Invalid run id: ${runIdStr}`);

  // Look up the session for this run. The run might not have a session yet
  // if it's still pending — poll briefly.
  let sessionId: string | null = null;
  for (let i = 0; i < 30; i++) {
    const { runs } = await apiRequest<{ runs: RunSummary[] }>(
      `/api/runs?limit=200`,
    );
    const run = runs.find((r) => r.id === runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (run.sessionId) {
      sessionId = run.sessionId;
      break;
    }
    if (run.status === "failure" || run.status === "aborted") {
      console.log(
        pc.red("✗"),
        `Run ended with status ${run.status}${run.error ? ": " + run.error : ""}`,
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!sessionId) {
    throw new Error(
      `Run ${runId} has no session yet — try again in a moment.`,
    );
  }

  console.log(pc.dim(`Tailing session ${sessionId}…`));
  const ac = new AbortController();
  process.on("SIGINT", () => ac.abort());

  await streamSse(
    `/api/sessions/${sessionId}/stream`,
    (evt) => {
      const d = evt.data as { kind?: string; payload?: unknown } | string;
      if (typeof d === "string") {
        console.log(pc.dim(evt.type), d);
        return;
      }
      const kind = d.kind ?? evt.type;
      if (kind === "done" || evt.type === "done") {
        const payload = d.payload as { status?: string } | undefined;
        console.log(
          pc.dim("─".repeat(40)),
          statusColor(payload?.status ?? "done"),
        );
        ac.abort();
        return;
      }
      const label = `[${kind}]`;
      const summary = formatEventPayload(d.payload);
      console.log(pc.cyan(label), summary);
    },
    ac.signal,
  ).catch((err) => {
    // AbortError on SIGINT or stream close is expected.
    if (err instanceof Error && err.name === "AbortError") return;
    throw err;
  });
}

function formatEventPayload(payload: unknown): string {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return String(payload);
  const obj = payload as Record<string, unknown>;
  if (typeof obj.type === "string") {
    // SDK message-shape: { type: "assistant"|"user"|"tool_use"|"result", ... }
    const t = obj.type;
    if (t === "assistant" || t === "user") {
      const content = obj.content;
      if (typeof content === "string") return `${t}: ${content.slice(0, 200)}`;
    }
    return `${t}`;
  }
  return JSON.stringify(obj).slice(0, 200);
}

export async function cmdSessionsList(opts: {
  agent?: string;
  status?: string;
  limit?: number;
}): Promise<void> {
  const params = new URLSearchParams();
  if (opts.agent) {
    const a = await resolveAgentByName(opts.agent);
    params.set("agentId", a.id);
  }
  if (opts.status) params.set("status", opts.status);
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const { sessions } = await apiRequest<{ sessions: SessionSummary[] }>(
    `/api/sessions${qs ? `?${qs}` : ""}`,
  );
  printTable(
    ["ID", "AGENT", "STATUS", "STARTED", "FINISHED"],
    sessions.map((s) => [
      s.id.slice(0, 8),
      s.agentName ?? "-",
      statusColor(s.status),
      fmtDate(s.startedAt),
      fmtDate(s.finishedAt),
    ]),
  );
}

export async function cmdTokensList(): Promise<void> {
  const { tokens } = await apiRequest<{ tokens: TokenSummary[] }>(
    "/api/tokens",
  );
  printTable(
    ["NAME", "PREFIX", "STATE", "LAST USED", "CREATED"],
    tokens.map((t) => {
      const state = t.revokedAt
        ? statusColor("revoked")
        : t.expiresAt && new Date(t.expiresAt) <= new Date()
          ? statusColor("expired")
          : statusColor("active");
      return [
        t.name,
        `agt_${t.prefix}…`,
        state,
        fmtDate(t.lastUsedAt),
        fmtDate(t.createdAt),
      ];
    }),
  );
}

export async function cmdTokensMint(name: string): Promise<void> {
  const r = await apiRequest<{
    token: string;
    id: string;
    name: string;
    prefix: string;
  }>("/api/tokens", { method: "POST", body: { name } });
  console.log(pc.bold("Token (copy now — shown once):"));
  console.log(pc.green(r.token));
  console.log(pc.dim(`id: ${r.id}  prefix: agt_${r.prefix}`));
}

export async function cmdTokensRevoke(id: string): Promise<void> {
  await apiRequest<unknown>(`/api/tokens/${id}`, { method: "DELETE" });
  console.log(pc.green("✓"), "Revoked.");
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

async function resolveAgentByName(name: string): Promise<AgentSummary> {
  const { agents } = await apiRequest<{ agents: AgentSummary[] }>(
    "/api/agents",
  );
  const a = agents.find((x) => x.name === name);
  if (!a) {
    throw new Error(
      `Agent "${name}" not found. Try: agents agents list`,
    );
  }
  return a;
}

export { ApiError };
