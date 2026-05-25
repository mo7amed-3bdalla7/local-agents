import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { api } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { ErrorBox } from "./AgentsList.tsx";

export function SessionsList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sessions"],
    queryFn: api.sessions.list,
  });

  return (
    <>
      <PageHeader
        title="Sessions"
        description="Resumable conversations. Each agent run opens a session; events stream into the timeline."
      />
      {isLoading && (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.sessions.length === 0 && (
        <EmptyState
          icon={Activity}
          title="No sessions yet"
          description="Sessions appear here once agents start running. Run-triggering via the api lands in a later commit; for now, trigger via `pnpm agent-run -- <name>` from the CLI."
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
