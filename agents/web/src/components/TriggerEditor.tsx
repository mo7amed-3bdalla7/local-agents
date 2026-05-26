import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../api.ts";

/**
 * Trigger editor — renders the current triggers list and (when editable)
 * lets you add a new one or drop an existing one. Doesn't talk to the API
 * directly; the parent passes the current triggers and an onChange callback
 * that gets the new array. Editing an existing trigger's fields is
 * intentionally "remove + add new" for slice-4 simplicity.
 *
 * Trigger shapes match @agents/sdk's exported types:
 *   cron      { type, schedule, timezone? }
 *   webhook   { type, path?, secret?, passBody? }
 *   file      { type, patterns, ignore?, debounceMs? }
 *   github    { type, repo, events, pollIntervalMs? }
 */

const GITHUB_PR_EVENTS = [
  "pr:opened",
  "pr:closed",
  "pr:merged",
  "pr:reopened",
  "pr:synchronize",
  "pr:reviewed",
  "pr:labeled",
  "pr:ready_for_review",
] as const;

const GITHUB_ISSUE_EVENTS = [
  "issue:opened",
  "issue:closed",
  "issue:reopened",
  "issue:labeled",
  "issue:assigned",
  "issue:commented",
] as const;

type GitHubEvent =
  | (typeof GITHUB_PR_EVENTS)[number]
  | (typeof GITHUB_ISSUE_EVENTS)[number];

type Trigger =
  | { type: "cron"; schedule: string; timezone?: string }
  | { type: "webhook"; path?: string; secret?: string; passBody?: boolean }
  | { type: "file"; patterns: string[]; ignore?: string[]; debounceMs?: number }
  | { type: "agent"; source: string; onSuccess?: boolean; onFailure?: boolean; passResult?: boolean }
  | { type: "github"; repo: string; events: GitHubEvent[]; pollIntervalMs?: number };

type NewType = "cron" | "webhook" | "file" | "github" | "agent";

export interface TriggerEditorProps {
  triggers: Trigger[];
  /** When false, render in display-only mode (used for file-source agents). */
  editable: boolean;
  onChange: (next: Trigger[]) => void;
}

export function TriggerEditor({ triggers, editable, onChange }: TriggerEditorProps) {
  const [adding, setAdding] = useState<NewType | null>(null);

  const add = (t: Trigger) => {
    onChange([...triggers, t]);
    setAdding(null);
  };
  const remove = (idx: number) => {
    onChange(triggers.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      {triggers.length === 0 && !adding && (
        <div className="rounded border border-dashed border-zinc-800 px-3 py-2 text-xs text-zinc-500">
          {editable
            ? "No triggers — this agent only runs when you click Run now or POST /api/agents/:id/run."
            : "No triggers."}
        </div>
      )}

      {triggers.map((t, i) => (
        <TriggerCard
          key={i}
          trigger={t}
          editable={editable}
          onRemove={() => remove(i)}
        />
      ))}

      {editable && !adding && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-zinc-500">Add:</span>
          {(["cron", "webhook", "file", "github", "agent"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setAdding(t)}
              className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              <Plus className="size-3" /> {t}
            </button>
          ))}
        </div>
      )}

      {editable && adding === "cron" && (
        <AddCron onCancel={() => setAdding(null)} onAdd={add} />
      )}
      {editable && adding === "webhook" && (
        <AddWebhook onCancel={() => setAdding(null)} onAdd={add} />
      )}
      {editable && adding === "file" && (
        <AddFile onCancel={() => setAdding(null)} onAdd={add} />
      )}
      {editable && adding === "github" && (
        <AddGitHub onCancel={() => setAdding(null)} onAdd={add} />
      )}
      {editable && adding === "agent" && (
        <AddAgent onCancel={() => setAdding(null)} onAdd={add} />
      )}
    </div>
  );
}

// ─── Trigger cards ──────────────────────────────────────────────────────────

function TriggerCard({
  trigger,
  editable,
  onRemove,
}: {
  trigger: Trigger;
  editable: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2">
      <div className="min-w-0 flex-1 text-xs">
        <div className="mb-0.5 font-mono uppercase tracking-wider text-emerald-300">
          {trigger.type}
        </div>
        <TriggerSummary trigger={trigger} />
      </div>
      {editable && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded border border-rose-500/30 bg-rose-500/10 p-1 text-rose-200 hover:bg-rose-500/20"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}

function TriggerSummary({ trigger }: { trigger: Trigger }) {
  switch (trigger.type) {
    case "cron":
      return (
        <div className="text-zinc-300">
          <code className="font-mono">{trigger.schedule}</code>
          {trigger.timezone && (
            <span className="text-zinc-500"> · {trigger.timezone}</span>
          )}
        </div>
      );
    case "webhook":
      return (
        <div className="text-zinc-300">
          POST <code className="font-mono">/api/triggers/{trigger.path ?? "(default)"}</code>
          {trigger.secret && <span className="text-amber-300"> · signed</span>}
          {trigger.passBody && <span className="text-zinc-500"> · body</span>}
        </div>
      );
    case "file":
      return (
        <div className="text-zinc-300">
          {trigger.patterns.map((p, i) => (
            <code key={i} className="mr-2 font-mono">
              {p}
            </code>
          ))}
          {trigger.debounceMs && (
            <span className="text-zinc-500"> · debounce {trigger.debounceMs}ms</span>
          )}
        </div>
      );
    case "github":
      return (
        <div className="text-zinc-300">
          <code className="font-mono">{trigger.repo}</code>
          <span className="text-zinc-500"> · {trigger.events.join(", ")}</span>
        </div>
      );
    case "agent":
      return (
        <div className="text-zinc-300">
          after <code className="font-mono">{trigger.source}</code>
          {trigger.onSuccess && <span className="text-emerald-300"> · on success</span>}
          {trigger.onFailure && <span className="text-rose-300"> · on failure</span>}
          {!trigger.onSuccess && !trigger.onFailure && (
            <span className="text-zinc-500"> · any outcome</span>
          )}
          {trigger.passResult && <span className="text-zinc-500"> · pass result</span>}
        </div>
      );
  }
}

// ─── Add forms ──────────────────────────────────────────────────────────────

function FormShell({
  type,
  onCancel,
  ready,
  onSubmit,
  children,
}: {
  type: string;
  onCancel: () => void;
  ready: boolean;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
        new {type} trigger
      </div>
      {children}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!ready}
          className="rounded border border-emerald-500/60 bg-emerald-500/20 px-2 py-1 text-xs text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500";

function AddCron({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (t: Trigger) => void;
}) {
  const [schedule, setSchedule] = useState("0 9 * * *");
  const [timezone, setTimezone] = useState("");
  const ready = schedule.trim().split(/\s+/).length === 5;
  return (
    <FormShell
      type="cron"
      onCancel={onCancel}
      ready={ready}
      onSubmit={() =>
        onAdd({
          type: "cron",
          schedule: schedule.trim(),
          ...(timezone.trim() ? { timezone: timezone.trim() } : {}),
        })
      }
    >
      <label className="block text-xs">
        <div className="mb-1 text-zinc-500">Schedule (5-field cron)</div>
        <input
          type="text"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          placeholder="0 9 * * *"
          className={inputCls}
        />
      </label>
      <label className="block text-xs">
        <div className="mb-1 text-zinc-500">Timezone (optional)</div>
        <input
          type="text"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="UTC"
          className={inputCls}
        />
      </label>
    </FormShell>
  );
}

function AddWebhook({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (t: Trigger) => void;
}) {
  const [path, setPath] = useState("");
  const [secret, setSecret] = useState("");
  const [passBody, setPassBody] = useState(true);
  return (
    <FormShell
      type="webhook"
      onCancel={onCancel}
      ready
      onSubmit={() =>
        onAdd({
          type: "webhook",
          ...(path.trim() ? { path: path.trim() } : {}),
          ...(secret ? { secret } : {}),
          passBody,
        })
      }
    >
      <label className="block text-xs">
        <div className="mb-1 text-zinc-500">Path (default: agent name)</div>
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="my-webhook"
          className={inputCls}
        />
      </label>
      <label className="block text-xs">
        <div className="mb-1 text-zinc-500">HMAC secret (optional)</div>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className={inputCls}
        />
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          className="size-3 cursor-pointer accent-emerald-500"
          checked={passBody}
          onChange={(e) => setPassBody(e.target.checked)}
        />
        Pass body into trigger context
      </label>
    </FormShell>
  );
}

function AddFile({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (t: Trigger) => void;
}) {
  const [patternsText, setPatternsText] = useState("");
  const [ignoreText, setIgnoreText] = useState("");
  const [debounceMs, setDebounceMs] = useState(500);
  const patterns = patternsText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const ignore = ignoreText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <FormShell
      type="file"
      onCancel={onCancel}
      ready={patterns.length > 0}
      onSubmit={() =>
        onAdd({
          type: "file",
          patterns,
          ...(ignore.length > 0 ? { ignore } : {}),
          ...(debounceMs !== 500 ? { debounceMs } : {}),
        })
      }
    >
      <label className="block text-xs">
        <div className="mb-1 text-zinc-500">Patterns (one per line)</div>
        <textarea
          value={patternsText}
          onChange={(e) => setPatternsText(e.target.value)}
          rows={3}
          placeholder="src/**/*.ts&#10;packages/**/index.ts"
          className={inputCls}
        />
      </label>
      <label className="block text-xs">
        <div className="mb-1 text-zinc-500">Ignore (one per line, optional)</div>
        <textarea
          value={ignoreText}
          onChange={(e) => setIgnoreText(e.target.value)}
          rows={2}
          placeholder="**/*.test.ts"
          className={inputCls}
        />
      </label>
      <label className="block text-xs">
        <div className="mb-1 text-zinc-500">Debounce (ms)</div>
        <input
          type="number"
          value={debounceMs}
          min={50}
          max={60000}
          onChange={(e) => setDebounceMs(Number(e.target.value))}
          className={inputCls}
        />
      </label>
    </FormShell>
  );
}

function AddGitHub({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (t: Trigger) => void;
}) {
  const [repo, setRepo] = useState("");
  const [events, setEvents] = useState<Set<GitHubEvent>>(new Set(["pr:opened"]));
  const [pollIntervalMs, setPollIntervalMs] = useState(60_000);
  const ready = /^[^/\s]+\/[^/\s]+$/.test(repo.trim()) && events.size > 0;
  const toggle = (e: GitHubEvent) => {
    setEvents((prev) => {
      const next = new Set(prev);
      next.has(e) ? next.delete(e) : next.add(e);
      return next;
    });
  };
  return (
    <FormShell
      type="github"
      onCancel={onCancel}
      ready={ready}
      onSubmit={() =>
        onAdd({
          type: "github",
          repo: repo.trim(),
          events: Array.from(events),
          ...(pollIntervalMs !== 60_000 ? { pollIntervalMs } : {}),
        })
      }
    >
      <label className="block text-xs">
        <div className="mb-1 text-zinc-500">Repo (owner/name)</div>
        <input
          type="text"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="anthropic/example"
          className={inputCls}
        />
      </label>
      <div className="text-xs">
        <div className="mb-1 text-zinc-500">PR events</div>
        <div className="grid grid-cols-2 gap-1">
          {GITHUB_PR_EVENTS.map((e) => (
            <label
              key={e}
              className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-300"
            >
              <input
                type="checkbox"
                className="size-3 cursor-pointer accent-emerald-500"
                checked={events.has(e)}
                onChange={() => toggle(e)}
              />
              <code className="font-mono">{e}</code>
            </label>
          ))}
        </div>
        <div className="mt-2 mb-1 text-zinc-500">Issue events</div>
        <div className="grid grid-cols-2 gap-1">
          {GITHUB_ISSUE_EVENTS.map((e) => (
            <label
              key={e}
              className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-300"
            >
              <input
                type="checkbox"
                className="size-3 cursor-pointer accent-emerald-500"
                checked={events.has(e)}
                onChange={() => toggle(e)}
              />
              <code className="font-mono">{e}</code>
            </label>
          ))}
        </div>
      </div>
      <label className="block text-xs">
        <div className="mb-1 text-zinc-500">Poll interval (ms)</div>
        <input
          type="number"
          value={pollIntervalMs}
          min={10_000}
          step={10_000}
          onChange={(e) => setPollIntervalMs(Number(e.target.value))}
          className={inputCls}
        />
      </label>
    </FormShell>
  );
}

function AddAgent({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (t: Trigger) => void;
}) {
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: api.agents.list,
  });
  const [source, setSource] = useState("");
  const [onSuccess, setOnSuccess] = useState(false);
  const [onFailure, setOnFailure] = useState(false);
  const [passResult, setPassResult] = useState(true);
  const ready = source.trim().length > 0;

  return (
    <FormShell
      type="agent"
      onCancel={onCancel}
      ready={ready}
      onSubmit={() =>
        onAdd({
          type: "agent",
          source: source.trim(),
          ...(onSuccess ? { onSuccess: true } : {}),
          ...(onFailure ? { onFailure: true } : {}),
          ...(passResult ? { passResult: true } : {}),
        })
      }
    >
      <label className="block text-xs">
        <div className="mb-1 text-zinc-500">Upstream agent</div>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className={inputCls}
        >
          <option value="">-- pick one --</option>
          {(agentsQuery.data?.agents ?? []).map((a) => (
            <option key={a.id} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="flex cursor-pointer items-center gap-2 text-zinc-300">
          <input
            type="checkbox"
            className="size-3 cursor-pointer accent-emerald-500"
            checked={onSuccess}
            onChange={(e) => setOnSuccess(e.target.checked)}
          />
          Only on success
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-zinc-300">
          <input
            type="checkbox"
            className="size-3 cursor-pointer accent-rose-500"
            checked={onFailure}
            onChange={(e) => setOnFailure(e.target.checked)}
          />
          Only on failure
        </label>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          className="size-3 cursor-pointer accent-emerald-500"
          checked={passResult}
          onChange={(e) => setPassResult(e.target.checked)}
        />
        Pass upstream result into trigger context
      </label>
      {onSuccess && onFailure && (
        <div className="text-[11px] text-amber-300">
          both checked = never fires; uncheck both for "any outcome"
        </div>
      )}
    </FormShell>
  );
}
