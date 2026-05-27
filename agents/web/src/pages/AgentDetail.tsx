import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Play, Square, Trash2 } from "lucide-react";
import {
  api,
  ApiError,
  type Connector,
  type McpServer,
  type RunSummary,
  type Skill,
} from "../api.ts";
import { PageHeader } from "../components/PageHeader.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { TriggerEditor } from "../components/TriggerEditor.tsx";
import { ErrorBox } from "../components/ErrorBox.tsx";

const IN_FLIGHT_STATUSES = new Set(["pending", "active"]);

export function AgentDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.agents.get(id),
    enabled: Boolean(id),
    // Always poll while the page is open so externally-triggered runs
    // (cron, webhook, file, github) appear without a manual refresh.
    // Tighten to 2s when a run is in flight for snappier badge transitions.
    refetchInterval: (query) =>
      query.state.data?.recentRuns.some((r) => IN_FLIGHT_STATUSES.has(r.status))
        ? 2000
        : 5000,
  });

  // Full registries are needed to render the un-attached items as togglable.
  const skillsQuery = useQuery({
    queryKey: ["skills"],
    queryFn: api.skills.list,
  });
  const connectorsQuery = useQuery({
    queryKey: ["connectors"],
    queryFn: api.connectors.list,
  });
  const mcpQuery = useQuery({
    queryKey: ["mcp"],
    queryFn: api.mcp.list,
  });

  const runMutation = useMutation({
    mutationFn: () => api.agents.run(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent", id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.agents.remove(id),
    onSuccess: () => {
      // Wipe the cached list so the next mount refetches.
      queryClient.removeQueries({ queryKey: ["agents"] });
      nav("/agents");
    },
  });

  // Trigger edits merge into configJson, replacing only the `triggers` field
  // so execution / model / etc. stay intact.
  const triggersMutation = useMutation({
    mutationFn: (nextTriggers: unknown[]) => {
      const current = (data?.agent.configJson ?? {}) as Record<string, unknown>;
      const updatedConfig = { ...current, triggers: nextTriggers };
      return api.agents.update(id, { configJson: updatedConfig });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["agent", id] }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["agent", id] });

  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-lg bg-zinc-900" />;
  }
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const { agent, recentSessions, recentRuns, skills, connectors, mcpServers } =
    data;

  return (
    <>
      <Link
        to="/agents"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" /> Agents
      </Link>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {agent.name}
            {isDryRun(agent.configJson) && (
              <span
                title="Mutating tools (Edit/Write/Bash) are stripped at runtime"
                className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300 ring-1 ring-inset ring-amber-500/30"
              >
                dry run
              </span>
            )}
            {(() => {
              const cap = maxCostUsd(agent.configJson);
              return cap != null ? (
                <span
                  title="The runner aborts the SDK loop when cumulative cost crosses this"
                  className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-300 ring-1 ring-inset ring-cyan-500/30"
                >
                  ≤ ${cap.toFixed(2)}
                </span>
              ) : null;
            })()}
          </span>
        }
        description={agent.description}
        actions={
          <div className="flex items-center gap-2">
            {agent.source === "db" && (
              <button
                type="button"
                onClick={() => {
                  if (
                    confirm(
                      `Delete agent "${agent.name}"? Sessions and runs stay; the agent row goes.`,
                    )
                  ) {
                    deleteMutation.mutate();
                  }
                }}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-sm font-medium text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
                title="Delete this db-source agent"
              >
                <Trash2 className="size-4" />
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
            >
              <Play className="size-4" />
              Run now
            </button>
          </div>
        }
      />

      {runMutation.error && (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <div className="font-medium">Run failed to enqueue</div>
          <div className="mt-1 text-rose-200/80">
            {runMutation.error instanceof ApiError
              ? runMutation.error.message
              : String(runMutation.error)}
          </div>
        </div>
      )}

      <StatsPanel agentId={agent.id} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            System prompt
          </h2>
          <pre className="max-h-[60vh] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-300">
            {agent.systemPrompt ?? "(no AGENTS.md found)"}
          </pre>
        </div>

        <div className="space-y-6">
          <Section title="Recent runs">
            {recentRuns.length === 0 && (
              <div className="text-sm text-zinc-500">No runs yet.</div>
            )}
            {recentRuns.map((run) => (
              <RecentRunRow
                key={run.id}
                run={run}
                onAfterAbort={() =>
                  queryClient.invalidateQueries({ queryKey: ["agent", id] })
                }
              />
            ))}
          </Section>

          <Section title="Recent sessions">
            {recentSessions.length === 0 && (
              <div className="text-sm text-zinc-500">No sessions yet.</div>
            )}
            {recentSessions.map((s) => (
              <Link
                key={s.id}
                to={`/sessions/${s.id}`}
                className="flex items-center justify-between border-b border-zinc-800 py-2 text-sm last:border-b-0 hover:text-zinc-100"
              >
                <div className="flex items-center gap-2">
                  <StatusBadge status={s.status} />
                  <span className="text-zinc-400">
                    {new Date(s.startedAt).toLocaleString()}
                  </span>
                </div>
                <span className="font-mono text-xs text-zinc-500">
                  {s.id.slice(0, 8)}
                </span>
              </Link>
            ))}
          </Section>

          <Section title="Triggers">
            <TriggerEditor
              triggers={
                (((agent.configJson as Record<string, unknown>)?.triggers ??
                  []) as Parameters<typeof TriggerEditor>[0]["triggers"]) ?? []
              }
              editable={agent.source === "db"}
              onChange={(next) => triggersMutation.mutate(next)}
            />
            {triggersMutation.error && (
              <div className="mt-2 text-xs text-rose-300">
                {triggersMutation.error instanceof ApiError
                  ? triggersMutation.error.message
                  : String(triggersMutation.error)}
              </div>
            )}
          </Section>

          <Section title="Skills">
            <CapabilityList
              items={skillsQuery.data?.skills ?? []}
              attachedKey={(s) => s.name}
              renderLabel={(s) => s.name}
              attached={new Map(skills.map((s) => [s.skill.name, s.enabled]))}
              onAttach={(s) => api.agents.attachSkill(id, s.name).then(invalidate)}
              onDetach={(s) => api.agents.detachSkill(id, s.name).then(invalidate)}
              emptyText="No skills in the registry."
            />
          </Section>

          <Section title="Connectors">
            <CapabilityList
              items={connectorsQuery.data?.connectors ?? []}
              attachedKey={(c) => c.id}
              renderLabel={(c) => `${c.displayName} · ${c.connectorType}`}
              attached={
                new Map(connectors.map((c) => [c.connector.id, c.enabled]))
              }
              onAttach={(c) => api.agents.attachConnector(id, c.id).then(invalidate)}
              onDetach={(c) => api.agents.detachConnector(id, c.id).then(invalidate)}
              emptyText="No connectors registered."
            />
          </Section>

          <Section title="MCP servers">
            <CapabilityList
              items={mcpQuery.data?.mcpServers ?? []}
              attachedKey={(m) => m.id}
              renderLabel={(m) => `${m.name} · ${m.transport}`}
              attached={
                new Map(mcpServers.map((m) => [m.mcpServer.id, m.enabled]))
              }
              onAttach={(m) => api.agents.attachMcp(id, m.id).then(invalidate)}
              onDetach={(m) => api.agents.detachMcp(id, m.id).then(invalidate)}
              emptyText="No MCP servers registered."
            />
          </Section>

          <Section title="Config">
            <pre className="max-h-72 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px] text-zinc-400">
              {JSON.stringify(agent.configJson, null, 2)}
            </pre>
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </h3>
      <div>{children}</div>
    </div>
  );
}

function RecentRunRow({
  run,
  onAfterAbort,
}: {
  run: RunSummary;
  onAfterAbort: () => void;
}) {
  const inFlight = run.status === "pending" || run.status === "active";

  const abortMutation = useMutation({
    mutationFn: () => api.runs.abort(run.id),
    onSuccess: onAfterAbort,
  });

  return (
    <div className="flex items-center justify-between border-b border-zinc-800 py-2 text-sm last:border-b-0">
      <div className="flex items-center gap-2">
        <StatusBadge status={run.status} />
        <span className="text-zinc-400">
          {new Date(run.createdAt).toLocaleString()}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {inFlight && (
          <button
            type="button"
            onClick={() => abortMutation.mutate()}
            disabled={abortMutation.isPending}
            title="Abort this run"
            className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
          >
            <Square className="size-3" /> Stop
          </button>
        )}
        {run.durationMs != null && (
          <span className="text-xs text-zinc-500">
            {(run.durationMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>
    </div>
  );
}

interface CapabilityListProps<T> {
  items: T[];
  attached: Map<string, boolean>;
  attachedKey: (item: T) => string;
  renderLabel: (item: T) => string;
  onAttach: (item: T) => void;
  onDetach: (item: T) => void;
  emptyText: string;
}

function CapabilityList<T extends Skill | Connector | McpServer>({
  items,
  attached,
  attachedKey,
  renderLabel,
  onAttach,
  onDetach,
  emptyText,
}: CapabilityListProps<T>) {
  if (items.length === 0) {
    return <div className="text-sm text-zinc-500">{emptyText}</div>;
  }
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const key = attachedKey(item);
        const state = attached.get(key);
        const isAttached = state !== undefined;
        return (
          <li
            key={key}
            className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/40 px-2.5 py-1.5 text-sm"
          >
            <span
              className={
                isAttached && !state ? "text-zinc-500 line-through" : "text-zinc-200"
              }
            >
              {renderLabel(item)}
            </span>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                className="size-3.5 cursor-pointer accent-emerald-500"
                checked={isAttached}
                onChange={() => (isAttached ? onDetach(item) : onAttach(item))}
              />
              {isAttached ? "attached" : "attach"}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function StatsPanel({ agentId }: { agentId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["agents", agentId, "stats"],
    queryFn: () => api.agents.stats(agentId),
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return <div className="mb-6 h-24 animate-pulse rounded-lg bg-zinc-900" />;
  }
  if (!data) return null;
  const s = data.stats;
  if (s.total === 0) return null;

  return (
    <div className="mb-6 space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Success rate"
          value={
            s.successRate == null
              ? "—"
              : `${(s.successRate * 100).toFixed(0)}%`
          }
          hint={`${s.successes}/${s.total} runs`}
          tone={
            s.successRate == null
              ? "neutral"
              : s.successRate >= 0.9
                ? "good"
                : s.successRate >= 0.5
                  ? "warn"
                  : "bad"
          }
        />
        <StatCard
          label="p50 duration"
          value={fmtDuration(s.p50DurationMs)}
          hint={`p95 ${fmtDuration(s.p95DurationMs)}`}
        />
        <StatCard
          label="Total cost"
          value={`$${s.totalCostUsd.toFixed(4)}`}
          hint={`${(s.inputTokens + s.outputTokens).toLocaleString()} tokens`}
        />
        <StatCard
          label="Runs"
          value={String(s.total)}
          hint={
            s.inFlight > 0
              ? `${s.inFlight} in flight`
              : s.failures > 0
                ? `${s.failures} failed`
                : "all done"
          }
        />
      </div>

      {data.recentFailures.length > 0 && (
        <details className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
          <summary className="cursor-pointer text-zinc-300">
            Recent failures ({data.recentFailures.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {data.recentFailures.map((r) => (
              <li
                key={r.id}
                className="grid grid-cols-[120px_80px_1fr] items-start gap-3 text-xs"
              >
                <span className="font-mono text-zinc-500">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
                <span className="text-rose-300">{r.status}</span>
                <span className="truncate text-zinc-400">
                  {r.error ?? "(no error message)"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    neutral: "text-zinc-100",
    good: "text-emerald-300",
    warn: "text-amber-300",
    bad: "text-rose-300",
  }[tone];
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-medium ${toneClass}`}>{value}</div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div>
      )}
    </div>
  );
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function isDryRun(configJson: Record<string, unknown> | null | undefined): boolean {
  if (!configJson || typeof configJson !== "object") return false;
  const exec = (configJson as { execution?: { dryRun?: unknown } }).execution;
  return exec?.dryRun === true;
}

function maxCostUsd(
  configJson: Record<string, unknown> | null | undefined,
): number | null {
  if (!configJson || typeof configJson !== "object") return null;
  const exec = (configJson as { execution?: { maxCostUsd?: unknown } })
    .execution;
  return typeof exec?.maxCostUsd === "number" && exec.maxCostUsd > 0
    ? exec.maxCostUsd
    : null;
}
