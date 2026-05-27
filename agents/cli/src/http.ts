/**
 * Tiny fetch wrapper used by every command. Adds the Bearer header from
 * loaded config, throws ApiError on non-2xx with the server's `message` or
 * `error` field surfaced. SSE helper streams a session's event timeline.
 */

import { loadConfig } from "./config.js";

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

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Require a token. Default true. */
  requireAuth?: boolean;
}

export async function apiRequest<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const cfg = loadConfig();
  if ((opts.requireAuth ?? true) && !cfg.token) {
    throw new ApiError(
      0,
      'Not logged in. Run "agents login --token agt_..." first.',
      null,
    );
  }

  const url = `${cfg.api}${path}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore non-JSON
    }
    const fromBody =
      body && typeof body === "object"
        ? "message" in body && body.message
          ? String((body as { message: unknown }).message)
          : "error" in body && body.error
            ? String((body as { error: unknown }).error)
            : ""
        : "";
    const msg = fromBody || `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Stream Server-Sent Events from /api/sessions/:id/stream. Calls `onEvent`
 * for each parsed `data: <json>` line. Resolves when the stream closes.
 */
export async function streamSse(
  path: string,
  onEvent: (event: { type: string; data: unknown }) => void,
  signal?: AbortSignal,
): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.token) {
    throw new ApiError(0, "Not logged in.", null);
  }
  const res = await fetch(`${cfg.api}${path}`, {
    headers: {
      accept: "text/event-stream",
      authorization: `Bearer ${cfg.token}`,
    },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new ApiError(res.status, `Stream failed: ${res.statusText}`, null);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE messages are separated by blank lines.
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let evType = "message";
      let dataLine = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) evType = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
      }
      if (dataLine) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          parsed = dataLine;
        }
        onEvent({ type: evType, data: parsed });
      }
    }
  }
}
