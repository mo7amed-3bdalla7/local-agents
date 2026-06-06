import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, FolderGit2, Plus, Save, Trash2 } from "lucide-react";
import { api, type Repo } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { ErrorBox } from "../components/ErrorBox.tsx";

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
  const [showContext, setShowContext] = useState(false);
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
            onClick={() => setShowContext((v) => !v)}
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 ${
              showContext
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-100"
                : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            }`}
            title="Per-repo CONTEXT.md"
          >
            <FileText className="size-3" /> Context
          </button>
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
      {showContext && <RepoContextEditor repo={repo} />}
    </div>
  );
}

/**
 * Inline editor for a repo's CONTEXT.md — materialized at the root of that
 * repo's checkout in every task workspace. The owner-wide CONTEXT.md (see the
 * Context page) still applies on top across all repos.
 */
function RepoContextEditor({ repo }: { repo: Repo }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["repo-context", repo.id],
    queryFn: () => api.repos.getContext(repo.id),
  });

  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && !dirty) setBody(data.body);
  }, [data, dirty]);

  const save = useMutation({
    mutationFn: () => api.repos.setContext(repo.id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repo-context", repo.id] });
      setDirty(false);
    },
  });

  return (
    <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs text-zinc-400">
          Materialized as{" "}
          <code className="font-mono text-zinc-300">CONTEXT.md</code> at this
          repo's checkout root. Repo-specific conventions you don't want to
          commit. Leave empty to remove.
        </div>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-500/60 bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
        >
          <Save className="size-3.5" />
          {save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
      </div>
      {isLoading ? (
        <div className="h-32 animate-pulse rounded bg-zinc-900" />
      ) : (
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setDirty(true);
          }}
          rows={10}
          placeholder={`# ${repo.githubFullName} context\n\n- Deploys go out via the release workflow, not main.\n- The legacy \`v1/\` dir is frozen — don't touch it.`}
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-100 outline-none focus:border-emerald-500"
        />
      )}
      {save.isError && (
        <div className="mt-2 rounded border border-rose-900/60 bg-rose-950/30 px-3 py-1.5 text-xs text-rose-300">
          {save.error instanceof Error ? save.error.message : "Save failed"}
        </div>
      )}
    </div>
  );
}
