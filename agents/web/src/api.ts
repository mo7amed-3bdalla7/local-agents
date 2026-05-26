/**
 * Thin fetch wrapper. All endpoints live behind /api (proxied to :3848 by Vite).
 */

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
    ...init,
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    const fromBody =
      body && typeof body === "object"
        ? ("message" in body && body.message
            ? String((body as { message: unknown }).message)
            : "error" in body && body.error
              ? String((body as { error: unknown }).error)
              : "")
        : "";
    const message = fromBody || `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message, body);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const api = {
  auth: {
    me: () => request<{ user: AuthUser }>("/auth/me"),
    login: (email: string, password: string) =>
      request<{ user: AuthUser }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    logout: () => request<unknown>("/auth/logout", { method: "POST" }),
    signupOpen: () =>
      request<{ signupOpen: boolean }>("/auth/signup-open"),
    signup: (email: string, password: string, name: string) =>
      request<{ user: AuthUser }>("/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password, name }),
      }),
  },
  agents: {
    list: () => request<{ agents: AgentSummary[] }>("/agents"),
    get: (id: string) =>
      request<{
        agent: Agent;
        recentSessions: SessionSummary[];
        recentRuns: RunSummary[];
        skills: SkillAttachment[];
        connectors: ConnectorAttachment[];
        mcpServers: McpAttachment[];
      }>(`/agents/${id}`),
    run: (id: string) =>
      request<unknown>(`/agents/${id}/run`, { method: "POST" }),
    attachSkill: (id: string, skillName: string, enabled = true) =>
      request<unknown>(`/agents/${id}/skills/${encodeURIComponent(skillName)}`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      }),
    detachSkill: (id: string, skillName: string) =>
      request<unknown>(`/agents/${id}/skills/${encodeURIComponent(skillName)}`, {
        method: "DELETE",
      }),
    attachConnector: (id: string, connectorId: string, enabled = true) =>
      request<unknown>(`/agents/${id}/connectors/${connectorId}`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      }),
    detachConnector: (id: string, connectorId: string) =>
      request<unknown>(`/agents/${id}/connectors/${connectorId}`, {
        method: "DELETE",
      }),
    attachMcp: (id: string, mcpServerId: string, enabled = true) =>
      request<unknown>(`/agents/${id}/mcp-servers/${mcpServerId}`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      }),
    detachMcp: (id: string, mcpServerId: string) =>
      request<unknown>(`/agents/${id}/mcp-servers/${mcpServerId}`, {
        method: "DELETE",
      }),
    create: (args: CreateAgentArgs) =>
      request<{ agent: Agent }>("/agents", {
        method: "POST",
        body: JSON.stringify(args),
      }),
    update: (id: string, args: UpdateAgentArgs) =>
      request<{ agent: Agent }>(`/agents/${id}`, {
        method: "PATCH",
        body: JSON.stringify(args),
      }),
    remove: (id: string) =>
      request<unknown>(`/agents/${id}`, { method: "DELETE" }),
  },
  sessions: {
    list: () => request<{ sessions: SessionSummary[] }>("/sessions"),
    get: (id: string) => request<{ session: Session }>(`/sessions/${id}`),
    events: (id: string) =>
      request<{ events: SessionEvent[] }>(`/sessions/${id}/events`),
  },
  runs: {
    list: (opts?: { agentId?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (opts?.agentId) params.set("agentId", opts.agentId);
      if (opts?.limit) params.set("limit", String(opts.limit));
      const qs = params.toString();
      return request<{ runs: RunSummary[] }>(`/runs${qs ? `?${qs}` : ""}`);
    },
    abort: (id: number) =>
      request<{ runId: number; status: string; method: string }>(
        `/runs/${id}/abort`,
        { method: "POST" },
      ),
  },
  connectors: {
    list: () => request<{ connectors: Connector[] }>("/connectors"),
    create: (args: CreateConnectorArgs) =>
      request<{ connector: Connector }>("/connectors", {
        method: "POST",
        body: JSON.stringify(args),
      }),
    remove: (id: string) =>
      request<unknown>(`/connectors/${id}`, { method: "DELETE" }),
    test: (id: string) =>
      request<TestResult>(`/connectors/${id}/test`, { method: "POST" }),
  },
  skills: {
    list: () => request<{ skills: Skill[] }>("/skills"),
  },
  mcp: {
    list: () => request<{ mcpServers: McpServer[] }>("/mcp-servers"),
    create: (args: CreateMcpServerArgs) =>
      request<{ mcpServer: McpServer }>("/mcp-servers", {
        method: "POST",
        body: JSON.stringify(args),
      }),
    remove: (id: string) =>
      request<unknown>(`/mcp-servers/${id}`, { method: "DELETE" }),
    test: (id: string) =>
      request<TestResult>(`/mcp-servers/${id}/test`, { method: "POST" }),
  },
  prActivity: {
    list: () => request<{ prActivity: PrActivity[] }>("/pr-activity"),
  },
  repos: {
    list: () => request<{ repos: Repo[] }>("/repos"),
    create: (args: CreateRepoArgs) =>
      request<{ repo: Repo }>("/repos", {
        method: "POST",
        body: JSON.stringify(args),
      }),
    remove: (id: string) =>
      request<unknown>(`/repos/${id}`, { method: "DELETE" }),
  },
  usage: {
    get: (days?: number) =>
      request<Usage>(`/usage${days != null ? `?days=${days}` : ""}`),
  },
  approvals: {
    list: (statuses?: PendingActionStatus[]) => {
      const qs = statuses && statuses.length > 0
        ? `?status=${statuses.join(",")}`
        : "";
      return request<{ approvals: PendingAction[]; executors: string[] }>(
        `/approvals${qs}`,
      );
    },
    approve: (id: string) =>
      request<{ approval: PendingAction }>(`/approvals/${id}/approve`, {
        method: "POST",
      }),
    reject: (id: string) =>
      request<{ approval: PendingAction }>(`/approvals/${id}/reject`, {
        method: "POST",
      }),
  },
};

export type PendingActionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed";

export interface PendingAction {
  id: string;
  sessionId: string | null;
  agentId: string;
  ownerId: string | null;
  kind: string;
  title: string;
  description: string | null;
  payload: Record<string, unknown>;
  status: PendingActionStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  executorResult: Record<string, unknown> | null;
  executorError: string | null;
  createdAt: string;
}

export interface Usage {
  windowDays: number;
  since: string;
  totals: {
    runs: number;
    successes: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
  };
  perAgent: Array<{
    agentId: string;
    agentName: string | null;
    runs: number;
    successes: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    costUsd: string;
  }>;
  perDay: Array<{
    day: string;
    runs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: string;
  }>;
}

export interface CreateRepoArgs {
  githubFullName: string;
  defaultBranch?: string;
  testCommand?: string;
}

// --- Types -----------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  source: "file" | "db";
  enabled: boolean;
  updatedAt: string;
}

export interface Agent extends AgentSummary {
  systemPrompt: string | null;
  configJson: Record<string, unknown>;
  createdAt: string;
}

export interface CreateAgentArgs {
  name: string;
  description: string;
  systemPrompt?: string;
  configJson?: Record<string, unknown>;
}

export interface UpdateAgentArgs {
  description?: string;
  systemPrompt?: string | null;
  configJson?: Record<string, unknown>;
  enabled?: boolean;
}

export interface SessionSummary {
  id: string;
  agentId: string;
  agentName?: string | null;
  status: "active" | "completed" | "failed" | "aborted" | "timeout";
  startedAt: string;
  finishedAt: string | null;
}

export interface Session extends SessionSummary {
  sdkSessionId: string | null;
  triggerContext: Record<string, unknown>;
  summaryJson: Record<string, unknown> | null;
}

export interface SessionEvent {
  id: number;
  sessionId: string;
  ts: string;
  kind:
    | "message"
    | "tool_call"
    | "tool_result"
    | "mcp_call"
    | "skill_invoke"
    | "comment_posted"
    | "commit_pushed"
    | "error";
  payload: Record<string, unknown>;
}

export interface RunSummary {
  id: number;
  agentId: string;
  agentName?: string | null;
  sessionId: string | null;
  status:
    | "pending"
    | "active"
    | "success"
    | "failure"
    | "timeout"
    | "aborted";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

export interface Connector {
  id: string;
  connectorType: string;
  displayName: string;
  configJson: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}

export interface CreateConnectorArgs {
  connectorType: string;
  displayName: string;
  configJson: Record<string, unknown>;
  secret?: string;
}

export interface TestResult {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
  toolsCount?: number;
}

export interface Skill {
  name: string;
  version: string | null;
  source: string;
  description: string;
  localPath: string;
  enabled: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpServer {
  id: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  configJson: Record<string, unknown>;
  enabled: boolean;
  cachedToolsJson: McpTool[] | null;
  cachedToolsFetchedAt: string | null;
}

export interface CreateMcpServerArgs {
  name: string;
  transport: "stdio" | "http" | "sse";
  configJson: Record<string, unknown>;
}

export interface PrActivity {
  id: string;
  sessionId: string | null;
  repoId: string;
  prNumber: number;
  kind: string;
  status: "drafted" | "pending_approval" | "posted" | "failed";
  githubUrl: string | null;
  createdAt: string;
  postedAt: string | null;
}

export interface Repo {
  id: string;
  githubFullName: string;
  localPath: string;
  defaultBranch: string;
  testCommand: string | null;
  secretRef: string | null;
  autoModes: Record<string, unknown>;
  createdAt: string;
}

export interface SkillAttachment {
  skill: Skill;
  enabled: boolean;
}

export interface ConnectorAttachment {
  connector: Connector;
  enabled: boolean;
}

export interface McpAttachment {
  mcpServer: McpServer;
  enabled: boolean;
}
