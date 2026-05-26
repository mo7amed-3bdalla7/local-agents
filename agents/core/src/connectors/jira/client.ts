/**
 * Thin Jira Cloud REST client. Auth = HTTP basic, email + API token.
 *
 * Slice-1 surface (read-only): /myself, GET /issue/<key>, GET /search/jql.
 * Writes (comments, transitions) live in a later slice.
 */

import type { JiraConfig, TestResult } from "../types.js";

export class JiraError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "JiraError";
  }
}

interface JiraDeps {
  config: JiraConfig;
  token: string;
}

function authHeader(deps: JiraDeps): string {
  const raw = `${deps.config.email}:${deps.token}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

async function jiraGet<T>(deps: JiraDeps, path: string): Promise<T> {
  const url = `${deps.config.host.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(deps),
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    throw new JiraError(res.status, `${res.status} ${res.statusText}`, body);
  }
  return (await res.json()) as T;
}

interface JiraMyself {
  accountId: string;
  emailAddress: string;
  displayName: string;
  active: boolean;
}

export async function jiraTest(deps: JiraDeps): Promise<TestResult> {
  try {
    const me = await jiraGet<JiraMyself>(deps, "/rest/api/3/myself");
    return {
      ok: true,
      message: `authenticated as ${me.displayName} <${me.emailAddress}>`,
      data: { accountId: me.accountId, active: me.active },
    };
  } catch (err) {
    if (err instanceof JiraError) {
      return {
        ok: false,
        message: `Jira API ${err.status}: ${err.message}`,
        data: { body: err.body },
      };
    }
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    assignee: { displayName: string; emailAddress?: string } | null;
    issuetype: { name: string };
    priority?: { name: string };
    updated: string;
    description?: unknown;
  };
}

export async function getIssue(
  deps: JiraDeps,
  key: string,
): Promise<JiraIssue> {
  return jiraGet<JiraIssue>(
    deps,
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,assignee,issuetype,priority,updated,description`,
  );
}

export interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
}

export async function searchIssues(
  deps: JiraDeps,
  jql: string,
  opts: { maxResults?: number } = {},
): Promise<JiraSearchResult> {
  const params = new URLSearchParams({
    jql,
    fields: "summary,status,assignee,issuetype,priority,updated",
    maxResults: String(opts.maxResults ?? 25),
  });
  return jiraGet<JiraSearchResult>(deps, `/rest/api/3/search/jql?${params}`);
}

async function jiraPost<T>(
  deps: JiraDeps,
  path: string,
  body: unknown,
): Promise<T> {
  const url = `${deps.config.host.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(deps),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errBody: unknown = null;
    try {
      errBody = await res.json();
    } catch {
      // ignore
    }
    throw new JiraError(res.status, `${res.status} ${res.statusText}`, errBody);
  }
  return (await res.json()) as T;
}

export interface JiraComment {
  id: string;
  self: string;
  body: unknown;
  created: string;
  updated: string;
  author?: { accountId: string; displayName: string };
}

/**
 * Post a comment on a Jira issue. Body is a plain string (auto-wrapped into
 * Atlassian Document Format paragraph) — pass raw ADF via the `adfBody` arg
 * if you need rich formatting.
 */
export async function postComment(
  deps: JiraDeps,
  issueKey: string,
  body: string,
  adfBody?: unknown,
): Promise<JiraComment> {
  const payload = adfBody
    ? { body: adfBody }
    : {
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: body }],
            },
          ],
        },
      };
  return jiraPost<JiraComment>(
    deps,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
    payload,
  );
}
