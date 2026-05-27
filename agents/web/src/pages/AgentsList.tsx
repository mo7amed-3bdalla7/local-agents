import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bot, ChevronRight, FileCode2, Plus } from "lucide-react";
import { api } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";

export function AgentsList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["agents"],
    queryFn: api.agents.list,
  });

  return (
    <>
      <PageHeader
        title="Agents"
        description="Configured agents — file-defined ones sync on api boot, db-defined ones are authored here."
        actions={
          <Link
            to="/agents/new"
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/60 bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-100 hover:bg-emerald-500/30"
          >
            <Plus className="size-4" /> New agent
          </Link>
        }
      />

      {isLoading && <Skeleton />}
      {error && <ErrorBox error={error} />}
      {data && data.agents.length === 0 && (
        <EmptyState
          icon={Bot}
          title="No agents discovered"
          description={
            <>
              The api boots with a filesystem sync. Add an{" "}
              <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs">
                agent.config.ts
              </code>{" "}
              under{" "}
              <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs">
                agents/&lt;name&gt;/
              </code>
              , run{" "}
              <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs">
                pnpm turbo build
              </code>
              , then restart the api.
            </>
          }
        />
      )}

      {data && data.agents.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
          {data.agents.map((agent) => (
            <Link
              key={agent.id}
              to={`/agents/${agent.id}`}
              className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3 last:border-b-0 hover:bg-zinc-900/50"
            >
              <Bot className="size-5 shrink-0 text-emerald-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate text-sm font-medium text-zinc-100">
                    {agent.name}
                  </div>
                  <SourceTag source={agent.source} />
                  {agent.dryRun && (
                    <span
                      title="Mutating tools (Edit/Write/Bash) are stripped at runtime"
                      className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300 ring-1 ring-inset ring-amber-500/30"
                    >
                      dry run
                    </span>
                  )}
                  {agent.maxCostUsd != null && (
                    <span
                      title="The runner aborts the SDK loop when cumulative cost crosses this"
                      className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-300 ring-1 ring-inset ring-cyan-500/30"
                    >
                      ≤ ${agent.maxCostUsd.toFixed(2)}
                    </span>
                  )}
                  {!agent.enabled && (
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                      disabled
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-sm text-zinc-400">
                  {agent.description}
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-zinc-600" />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function SourceTag({ source }: { source: "file" | "db" }) {
  if (source === "file") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
        <FileCode2 className="size-3" /> file
      </span>
    );
  }
  return (
    <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-blue-300">
      db
    </span>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}
