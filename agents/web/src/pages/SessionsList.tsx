import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import {
  api,
  type SessionSummary,
  type SessionsListFilters,
} from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { ErrorBox } from "./AgentsList.tsx";

const ALL_STATUSES: Array<SessionSummary["status"]> = [
  "active",
  "completed",
  "failed",
  "aborted",
  "timeout",
];

export function SessionsList() {
  const [params, setParams] = useSearchParams();

  const filters: SessionsListFilters = useMemo(() => {
    const status = params
      .get("status")
      ?.split(",")
      .filter((s): s is SessionSummary["status"] =>
        ALL_STATUSES.includes(s as SessionSummary["status"]),
      );
    return {
      status: status && status.length > 0 ? status : undefined,
      agentId: params.get("agentId") ?? undefined,
      since: params.get("since") ?? undefined,
      until: params.get("until") ?? undefined,
    };
  }, [params]);

  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: api.agents.list,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["sessions", filters],
    queryFn: () => api.sessions.list(filters),
    refetchInterval: 5000,
  });

  function update(patch: Partial<Record<string, string | undefined>>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  }

  function toggleStatus(s: SessionSummary["status"]) {
    const current = filters.status ?? [];
    const next = current.includes(s)
      ? current.filter((x) => x !== s)
      : [...current, s];
    update({ status: next.length > 0 ? next.join(",") : undefined });
  }

  const activeFilterCount =
    (filters.status?.length ?? 0) +
    (filters.agentId ? 1 : 0) +
    (filters.since ? 1 : 0) +
    (filters.until ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Sessions"
        description="Resumable conversations. Each agent run opens a session; events stream into the timeline."
      />

      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-zinc-400">Status:</span>
          {ALL_STATUSES.map((s) => {
            const on = filters.status?.includes(s) ?? false;
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset transition-colors ${
                  on
                    ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                    : "bg-zinc-900 text-zinc-400 ring-zinc-800 hover:bg-zinc-800/60"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-zinc-400">
            Agent:
            <select
              value={filters.agentId ?? ""}
              onChange={(e) => update({ agentId: e.target.value || undefined })}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
            >
              <option value="">All</option>
              {agents.data?.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-zinc-400">
            Since:
            <input
              type="datetime-local"
              value={isoToLocal(filters.since)}
              onChange={(e) =>
                update({ since: localToIso(e.target.value) })
              }
              className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-zinc-400">
            Until:
            <input
              type="datetime-local"
              value={isoToLocal(filters.until)}
              onChange={(e) =>
                update({ until: localToIso(e.target.value) })
              }
              className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
            />
          </label>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
              className="ml-auto rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
            >
              Clear ({activeFilterCount})
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.sessions.length === 0 && (
        <EmptyState
          icon={Activity}
          title={activeFilterCount > 0 ? "No sessions match filters" : "No sessions yet"}
          description={
            activeFilterCount > 0
              ? "Try widening the filters or clearing them."
              : "Sessions appear here once agents start running."
          }
        />
      )}
      {data && data.sessions.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
          {data.sessions.map((s) => (
            <Link
              key={s.id}
              to={`/sessions/${s.id}`}
              className="grid grid-cols-[1fr_120px_180px_180px] items-center gap-3 border-b border-zinc-800 px-4 py-3 text-sm last:border-b-0 hover:bg-zinc-900/50"
            >
              <div>
                <div className="font-medium text-zinc-100">
                  {s.agentName ?? "(deleted agent)"}
                </div>
                <div className="font-mono text-xs text-zinc-500">
                  {s.id.slice(0, 8)}
                </div>
              </div>
              <StatusBadge status={s.status} />
              <div className="text-xs text-zinc-400">
                {new Date(s.startedAt).toLocaleString()}
              </div>
              <div className="text-xs text-zinc-500">
                {s.finishedAt
                  ? new Date(s.finishedAt).toLocaleString()
                  : "—"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/** ISO (UTC) -> "YYYY-MM-DDTHH:mm" in the user's local zone for datetime-local. */
function isoToLocal(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function localToIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
