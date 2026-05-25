import { useQuery } from "@tanstack/react-query";
import { FolderGit2 } from "lucide-react";
import { api } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { ErrorBox } from "./AgentsList.tsx";

export function ReposList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["repos"],
    queryFn: api.repos.list,
  });

  return (
    <>
      <PageHeader
        title="Repos"
        description="Repositories the platform clones and worktrees for agents. Register with `pnpm repo register --github owner/name`."
      />
      {isLoading && (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.repos.length === 0 && (
        <EmptyState
          icon={FolderGit2}
          title="No repos registered"
          description="Run `pnpm repo register --github owner/name` to clone one. Agents call into the same registry via `pnpm repo ensure-worktree` to get a managed checkout."
        />
      )}
      {data && data.repos.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
          {data.repos.map((r) => (
            <div
              key={r.id}
              className="border-b border-zinc-800 px-4 py-3 last:border-b-0"
            >
              <div className="flex items-center justify-between">
                <div className="font-mono text-sm text-zinc-100">
                  {r.githubFullName}
                </div>
                <span className="text-xs text-zinc-500">
                  default: {r.defaultBranch}
                </span>
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">
                {r.localPath}
              </div>
              {r.testCommand && (
                <div className="mt-1 text-xs text-zinc-400">
                  test: <code className="font-mono">{r.testCommand}</code>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
