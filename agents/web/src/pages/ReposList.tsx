import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderGit2, Plus, Trash2 } from "lucide-react";
import { api, type Repo } from "../api.ts";
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
        description="Repositories the platform clones + worktrees for agents. Each row is a managed clone at ~/.agents/worktrees/<owner>__<name>/.repo."
        actions={
          <Link
            to="/repos/new"
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/60 bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-100 hover:bg-emerald-500/30"
          >
            <Plus className="size-4" /> New repo
          </Link>
        }
      />
      {isLoading && (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.repos.length === 0 && (
        <EmptyState
          icon={FolderGit2}
          title="No repos registered"
          description="Click `New repo` (or run `pnpm repo register --github owner/name` from a shell). Agents call into the same registry via `pnpm repo ensure-worktree` to get a managed checkout."
        />
      )}
      {data && data.repos.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
          {data.repos.map((r) => (
            <RepoRow key={r.id} repo={r} />
          ))}
        </div>
      )}
    </>
  );
}

function RepoRow({ repo }: { repo: Repo }) {
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: () => api.repos.remove(repo.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["repos"] });
    },
  });

  return (
    <div className="border-b border-zinc-800 px-4 py-3 last:border-b-0">
      <div className="flex items-center justify-between">
        <div className="font-mono text-sm text-zinc-100">
          {repo.githubFullName}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-zinc-500">default: {repo.defaultBranch}</span>
          <button
            type="button"
            onClick={() => {
              if (
                confirm(
                  `Drop repo "${repo.githubFullName}" from the registry? The local clone at ${repo.localPath} stays on disk.`,
                )
              ) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
            className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>
      <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">
        {repo.localPath}
      </div>
      {repo.testCommand && (
        <div className="mt-1 text-xs text-zinc-400">
          test: <code className="font-mono">{repo.testCommand}</code>
        </div>
      )}
    </div>
  );
}
