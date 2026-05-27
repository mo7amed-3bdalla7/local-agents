import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Copy, FileStack, Sparkles, X } from "lucide-react";
import {
  api,
  ApiError,
  type AgentTemplate,
} from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { ErrorBox } from "../components/ErrorBox.tsx";

export function TemplatesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["templates"],
    queryFn: api.templates.list,
  });
  const [selected, setSelected] = useState<AgentTemplate | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<string, AgentTemplate[]>();
    for (const t of data?.templates ?? []) {
      const arr = m.get(t.category) ?? [];
      arr.push(t);
      m.set(t.category, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  return (
    <>
      <PageHeader
        title="Templates"
        description="Pre-built agent recipes. Clone one into your own db-source agent — you can edit the system prompt and config afterwards."
      />

      {isLoading && (
        <div className="h-24 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.templates.length === 0 && (
        <EmptyState
          icon={FileStack}
          title="No templates available"
          description="The platform seeds a few defaults on startup. If you see this, the seed didn't run."
        />
      )}

      {data && data.templates.length > 0 && (
        <div className="space-y-6">
          {grouped.map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {category}
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {items.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    onClone={() => setSelected(t)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {selected && (
        <CloneModal template={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function TemplateCard({
  template,
  onClone,
}: {
  template: AgentTemplate;
  onClone: () => void;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-emerald-400" />
          <h3 className="text-sm font-medium text-zinc-100">{template.name}</h3>
        </div>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
          {template.slug}
        </span>
      </div>
      <p className="mb-3 flex-1 text-sm text-zinc-400">{template.description}</p>
      {template.recommendedConnectors.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {template.recommendedConnectors.map((c) => (
            <span
              key={c}
              className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-blue-300 ring-1 ring-inset ring-blue-500/30"
              title="Recommended connector"
            >
              {c}
            </span>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onClone}
        className="flex items-center justify-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
      >
        <Copy className="size-4" />
        Clone
      </button>
    </div>
  );
}

function CloneModal({
  template,
  onClose,
}: {
  template: AgentTemplate;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(`${template.slug}-mine`);
  const [description, setDescription] = useState(template.description);
  const [error, setError] = useState<string | null>(null);

  const clone = useMutation({
    mutationFn: () =>
      api.templates.clone(template.slug, {
        name: name.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: (resp) => {
      queryClient.removeQueries({ queryKey: ["agents"] });
      navigate(`/agents/${resp.agent.id}`);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Clone failed",
      );
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    clone.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-zinc-100">
              Clone “{template.name}”
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              Creates a new db-source agent owned by you. You can edit the prompt and config afterwards.
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
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-400">Agent name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 font-mono"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-400">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          {error && (
            <div className="rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={clone.isPending}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {clone.isPending ? "Cloning…" : "Clone"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
