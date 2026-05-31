import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
} from "lucide-react";
import { api, ApiError, type SkillSearchHit } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { ErrorBox } from "../components/ErrorBox.tsx";

const RESULTS_CAP = 30;

export function SkillsList() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["skills"],
    queryFn: api.skills.list,
  });

  const [queryStr, setQueryStr] = useState("");
  const [submitted, setSubmitted] = useState<string>("");
  const search = useQuery({
    queryKey: ["skills", "search", submitted],
    queryFn: () => api.skills.search(submitted),
    enabled: submitted.length > 0,
  });

  const [installMsg, setInstallMsg] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const install = useMutation({
    mutationFn: (hit: SkillSearchHit) =>
      api.skills.install(hit.source, hit.skillId),
    onSuccess: (_res, hit) => {
      setInstallMsg({
        kind: "ok",
        text: `Installed ${hit.name} from ${hit.source}`,
      });
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: (err) => {
      setInstallMsg({
        kind: "err",
        text: err instanceof ApiError ? err.message : String(err),
      });
    },
  });

  const installedNames = new Set((data?.skills ?? []).map((s) => s.name));

  return (
    <>
      <PageHeader
        title="Skills"
        description="Filesystem-discovered SKILL.md folders. Search skills.sh to install new ones."
      />

      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Installed
      </div>

      {isLoading && (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.skills.length === 0 && (
        <EmptyState
          icon={Sparkles}
          title="No skills installed yet"
          description={
            "Search skills.sh below to install your first skill, or drop a SKILL.md folder under .claude/skills/ at the repo root and restart the API server."
          }
        />
      )}
      {data && data.skills.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
          {data.skills.map((s) => (
            <div
              key={s.name}
              className="border-b border-zinc-800 px-4 py-3 last:border-b-0"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-zinc-100">
                  {s.name}
                </div>
                <span className="shrink-0 truncate font-mono text-xs text-zinc-500">
                  {s.source}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-zinc-400">{s.description}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Search skills.sh
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(queryStr.trim());
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={queryStr}
              onChange={(e) => setQueryStr(e.target.value)}
              placeholder="e.g. pdf, slack, playwright, postgres…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-2 pl-8 pr-3 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
          </div>
          <button
            type="submit"
            disabled={!queryStr.trim()}
            className="rounded-md border border-emerald-500/60 bg-emerald-500/20 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
          >
            Search
          </button>
        </form>

        {installMsg && (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-xs ${
              installMsg.kind === "ok"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/40 bg-rose-500/10 text-rose-200"
            }`}
          >
            {installMsg.text}
          </div>
        )}

        {submitted && search.isLoading && (
          <div className="mt-3 h-12 animate-pulse rounded bg-zinc-900" />
        )}
        {submitted && search.error && (
          <div className="mt-3 text-xs text-rose-400">
            {search.error instanceof ApiError
              ? search.error.message
              : String(search.error)}
          </div>
        )}
        {submitted && search.data && search.data.skills.length === 0 && (
          <div className="mt-3 text-xs text-zinc-500">
            No matches on skills.sh for "{submitted}".
          </div>
        )}
        {submitted && search.data && search.data.skills.length > 0 && (
          <>
            <div className="mt-3 overflow-hidden rounded-md border border-zinc-800">
              {search.data.skills.slice(0, RESULTS_CAP).map((hit) => {
                const isPending =
                  install.isPending && install.variables?.id === hit.id;
                const installed = installedNames.has(hit.name);
                const detailsUrl = `https://skills.sh/${hit.source}/${hit.skillId}`;
                const sourceUrl = `https://github.com/${hit.source}`;
                return (
                  <div
                    key={hit.id}
                    className="flex items-center gap-3 border-b border-zinc-800 px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <a
                        href={detailsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-zinc-100 hover:text-emerald-300"
                        title="View skill details on skills.sh"
                      >
                        {hit.name}
                        <ExternalLink className="size-3 opacity-60" />
                      </a>
                      <div className="truncate font-mono text-[11px] text-zinc-500">
                        <a
                          href={sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-zinc-300"
                          title="Open source repo on GitHub"
                        >
                          {hit.source}
                        </a>
                        {hit.skillId !== hit.source && <> · {hit.skillId}</>}
                        {typeof hit.installs === "number" && (
                          <> · {hit.installs.toLocaleString()} installs</>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={install.isPending || installed}
                      onClick={() => {
                        setInstallMsg(null);
                        install.mutate(hit);
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                      title={
                        installed
                          ? "Already installed — see the list above"
                          : "Install this skill"
                      }
                    >
                      {isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                      {installed ? "Installed" : "Install"}
                    </button>
                  </div>
                );
              })}
            </div>
            {search.data.skills.length > RESULTS_CAP && (
              <div className="mt-2 text-[11px] text-zinc-500">
                Showing top {RESULTS_CAP} of {search.data.skills.length}{" "}
                results — refine your query to narrow.
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
