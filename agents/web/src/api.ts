/**
 * Thin fetch wrapper. All endpoints live behind /api (proxied to :3848 by Vite).
 */

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    const message =
      (body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : "") || `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message, body);
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
  agents: {
    list: () => request<{ agents: AgentSummary[] }>("/agents"),
    get: (id: string) =>
      request<{
        agent: Agent;
        recentSessions: SessionSummary[];
        recentRuns: RunSummary[];
      }>(`/agents/${id}`),
    run: (id: string) =>
      request<unknown>(`/agents/${id}/run`, { method: "POST" }),
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
  },
  connectors: {
    list: () => request<{ connectors: Connector[] }>("/connectors"),
  },
  skills: {
    list: () => request<{ skills: Skill[] }>("/skills"),
  },
  mcp: {
    list: () => request<{ mcpServers: McpServer[] }>("/mcp-servers"),
  },
  prActivity: {
    list: () => request<{ prActivity: PrActivity[] }>("/pr-activity"),
  },
};

// --- Types -----------------------------------------------------------------

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

export interface Skill {
  name: string;
  version: string | null;
  source: string;
  description: string;
  localPath: string;
  enabled: boolean;
}

export interface McpServer {
  id: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  configJson: Record<string, unknown>;
  enabled: boolean;
  cachedToolsJson: unknown;
  cachedToolsFetchedAt: string | null;
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
