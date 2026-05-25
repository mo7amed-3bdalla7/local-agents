import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Play } from "lucide-react";
import { api, ApiError } from "../api.ts";
import { PageHeader } from "../components/PageHeader.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { ErrorBox } from "./AgentsList.tsx";

export function AgentDetail() {
  const { id = "" } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.agents.get(id),
    enabled: Boolean(id),
  });

  const runMutation = useMutation({
    mutationFn: () => api.agents.run(id),
  });

  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-lg bg-zinc-900" />;
  }
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const { agent, recentSessions, recentRuns } = data;

  return (
    <>
      <Link
        to="/agents"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" /> Agents
      </Link>
      <PageHeader
        title={agent.name}
        description={agent.description}
        actions={
          <button
            type="button"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
          >
            <Play className="size-4" />
            Run now
          </button>
        }
      />

      {runMutation.error && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <div className="font-medium">Run-triggering not wired yet</div>
          <div className="mt-1 text-amber-200/80">
            {runMutation.error instanceof ApiError
              ? runMutation.error.message
              : String(runMutation.error)}
          </div>
        </div>
      )}

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
              <div
                key={run.id}
                className="flex items-center justify-between border-b border-zinc-800 py-2 text-sm last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <StatusBadge status={run.status} />
                  <span className="text-zinc-400">
                    {new Date(run.createdAt).toLocaleString()}
                  </span>
                </div>
                {run.durationMs != null && (
                  <span className="text-xs text-zinc-500">
                    {(run.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
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
