import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Briefcase, Plus, X } from "lucide-react";
import { api, ApiError, type CreateTaskArgs } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBox } from "../components/ErrorBox.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";

export function TasksPage() {
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["tasks"],
    queryFn: api.tasks.list,
    refetchInterval: 5000,
  });

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Bundle a brief + linked repos for an agent to work on. The senior-engineer template is designed for this — it reads BRIEF.md, navigates each repo, and stages every commit for approval."
        actions={
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/60 bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-100 hover:bg-emerald-500/30"
          >
            <Plus className="size-4" />
            New task
          </button>
        }
      />

      {isLoading && (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.tasks.length === 0 && !isLoading && (
        <EmptyState
          icon={Briefcase}
          title="No tasks yet"
          description="Click New task to give an agent a brief plus a set of repos. The senior-engineer template (under /templates) is built for this."
        />
      )}
      {data && data.tasks.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
          {data.tasks.map((t) => (
            <Link
              key={t.id}
              to={`/tasks/${t.id}`}
              className="grid grid-cols-[1fr_120px_160px_140px] items-center gap-3 border-b border-zinc-800 px-4 py-3 text-sm last:border-b-0 hover:bg-zinc-900/50"
            >
              <div>
                <div className="font-medium text-zinc-100">{t.title}</div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {t.repos.length} repo{t.repos.length === 1 ? "" : "s"} ·{" "}
                  {t.repos.slice(0, 2).map((r) => r.githubFullName).join(", ")}
                  {t.repos.length > 2 ? "…" : ""}
                </div>
              </div>
              <StatusBadge status={t.status} />
              <div className="text-xs text-zinc-400">
                {new Date(t.createdAt).toLocaleString()}
              </div>
              <div className="text-xs text-zinc-500">
                {t.finishedAt
                  ? new Date(t.finishedAt).toLocaleString()
                  : t.startedAt
                    ? "running…"
                    : "—"}
              </div>
            </Link>
          ))}
        </div>
      )}

      {showForm && <NewTaskModal onClose={() => setShowForm(false)} />}
    </>
  );
}

function NewTaskModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: api.agents.list,
  });
  const reposQuery = useQuery({
    queryKey: ["repos"],
    queryFn: api.repos.list,
  });

  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [agentId, setAgentId] = useState("");
  const [repoIds, setRepoIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (args: CreateTaskArgs) => api.tasks.create(args),
    onSuccess: ({ task }) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      navigate(`/tasks/${task.id}`);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Create failed",
      );
    },
  });

  function toggleRepo(id: string) {
    setRepoIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !brief.trim() || !agentId || repoIds.size === 0) return;
    create.mutate({
      title: title.trim(),
      brief: brief.trim(),
      agentId,
      repoIds: Array.from(repoIds),
    });
  }

  const ready =
    title.trim().length > 0 &&
    brief.trim().length > 0 &&
    !!agentId &&
    repoIds.size > 0 &&
    !create.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <Briefcase className="size-4 text-emerald-300" />
              New task
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              Linked repos are cloned into a workspace dir; the agent's <code className="text-zinc-300">cwd</code> is the workspace root, and a <code className="text-zinc-300">BRIEF.md</code> at that root carries this brief.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
          >
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-400">Title</span>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Migrate the auth layer to JWT"
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-400">Brief</span>
            <textarea
              required
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={8}
              placeholder="Spell out what should change, in which repos, and how to verify."
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-400">Agent</span>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="">Pick an agent…</option>
              {agentsQuery.data?.agents
                .filter((a) => a.enabled)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-400">
              Linked repos ({repoIds.size} selected)
            </span>
            {reposQuery.data && reposQuery.data.repos.length === 0 ? (
              <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
                No repos registered.{" "}
                <Link to="/repos/new" className="text-emerald-400 hover:underline">
                  Add one
                </Link>{" "}
                first.
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-2">
                {reposQuery.data?.repos.map((r) => (
                  <label
                    key={r.id}
                    className="flex cursor-pointer items-center gap-2 px-1 py-1 text-sm hover:bg-zinc-900"
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 cursor-pointer accent-emerald-500"
                      checked={repoIds.has(r.id)}
                      onChange={() => toggleRepo(r.id)}
                    />
                    <span className="font-mono text-xs text-zinc-200">
                      {r.githubFullName}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {r.defaultBranch}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {error && (
            <div className="rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
              {error}
            </div>
          )}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={!ready}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {create.isPending ? "Materializing…" : "Create + run"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              Cancel
            </button>
            {create.isPending && (
              <span className="text-xs text-zinc-500">
                cloning repos + writing BRIEF.md…
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Task detail ─────────────────────────────────────────────────────────

export function TaskDetailRoute() {
  const { id = "" } = useParams();
  return <TaskDetail id={id} />;
}

function TaskDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["task", id],
    queryFn: () => api.tasks.get(id),
    refetchInterval: (q) => {
      const s = q.state.data?.task.status;
      return s === "pending" || s === "active" ? 3000 : 10_000;
    },
  });

  const remove = useMutation({
    mutationFn: () => api.tasks.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      navigate("/tasks");
    },
  });

  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-lg bg-zinc-900" />;
  }
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const t = data.task;

  return (
    <>
      <Link
        to="/tasks"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        ← Tasks
      </Link>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {t.title}
            <StatusBadge status={t.status} />
          </span>
        }
        description={
          <span className="text-xs text-zinc-500">
            created {new Date(t.createdAt).toLocaleString()}
            {t.finishedAt &&
              ` · finished ${new Date(t.finishedAt).toLocaleString()}`}
          </span>
        }
        actions={
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete task "${t.title}"?`)) remove.mutate();
            }}
            className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-500/20"
          >
            Delete
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Brief">
            <pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm leading-relaxed text-zinc-200">
              {t.brief}
            </pre>
          </Section>

          {t.runId && (
            <Section title="Run">
              <Link
                to={`/sessions${t.runId ? "" : ""}`}
                className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:underline"
              >
                See run #{t.runId} in sessions →
              </Link>
              <div className="mt-1 text-xs text-zinc-500">
                Workspace:{" "}
                <code className="font-mono text-zinc-400">{t.workspacePath}</code>
              </div>
            </Section>
          )}
        </div>

        <div className="space-y-6">
          <Section title="Linked repos">
            <ul className="space-y-1.5">
              {t.repos.map((r) => (
                <li
                  key={r.repoId}
                  className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/40 px-2.5 py-1.5 text-sm"
                >
                  <span className="font-mono text-xs text-zinc-200">
                    {r.githubFullName}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {r.defaultBranch}
                  </span>
                </li>
              ))}
            </ul>
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
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </h2>
      {children}
    </div>
  );
}
