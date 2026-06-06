import { useEffect, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Compass, Save } from "lucide-react";
import { api, ApiError } from "../api.ts";
import { ErrorBox } from "../components/ErrorBox.tsx";
import { PageHeader } from "../components/PageHeader.tsx";

export function ContextPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["user-context"],
    queryFn: api.context.get,
  });

  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (data && !dirty) setBody(data.body);
  }, [data, dirty]);

  const save = useMutation({
    mutationFn: () => api.context.set(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-context"] });
      setDirty(false);
      setSaveError(null);
    },
    onError: (err) => {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Save failed",
      );
    },
  });

  return (
    <>
      <PageHeader
        title="Context"
        description="One markdown document that gets materialized as CONTEXT.md at the root of every task workspace you create. Use it for coding style, on-call rotation, sprint goals, project glossary — anything your agents should know across every repo. For conventions scoped to a single repo, set a per-repo CONTEXT.md from the Repos page; repo-specific docs (AGENTS.md/CLAUDE.md) committed in each repo still take precedence on project details."
        actions={
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/60 bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
          >
            <Save className="size-4" />
            {save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        }
      />

      {isLoading && (
        <div className="h-96 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}

      {data && (
        <>
          {data.updatedAt && (
            <div className="mb-3 text-xs text-zinc-500">
              Last updated: {new Date(data.updatedAt).toLocaleString()}
              {dirty && (
                <span className="ml-2 text-amber-400">• unsaved changes</span>
              )}
            </div>
          )}
          {!data.updatedAt && (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-400">
              <Compass className="mt-0.5 size-4 shrink-0 text-emerald-400" />
              <div>
                You haven't set a context yet. Try seeding it with sections
                like "Coding conventions", "Operational context", "Glossary",
                or "What I'm working on this sprint" — the senior-engineer
                template will read this before touching any code.
              </div>
            </div>
          )}
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setDirty(true);
            }}
            rows={28}
            placeholder={`# My context

## Coding conventions
- Prefer plain functions over classes unless state demands it.
- All new tests use Vitest under \`*.test.ts\` next to the unit they cover.

## Operational
- We deploy from main; PRs merge via squash.
- On-call rotates weekly; see @ops-roster in Slack.

## Glossary
- "Worktree": ...
`}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-100 outline-none focus:border-emerald-500"
          />
          {saveError && (
            <div className="mt-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
              {saveError}
            </div>
          )}
        </>
      )}
    </>
  );
}
