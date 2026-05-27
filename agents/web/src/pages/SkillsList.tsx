import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { ErrorBox } from "../components/ErrorBox.tsx";

export function SkillsList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["skills"],
    queryFn: api.skills.list,
  });

  return (
    <>
      <PageHeader
        title="Skills"
        description="Filesystem-discovered SKILL.md folders. Attach per agent on the agent's detail page."
      />
      {isLoading && (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.skills.length === 0 && (
        <EmptyState
          icon={Sparkles}
          title="No skills found"
          description={
            "Drop a SKILL.md folder under .claude/skills/ at the repo root (or run `npx skills add owner/repo`) and restart the API server to pick it up."
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
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-zinc-100">
                  {s.name}
                </div>
                <span className="text-xs text-zinc-500">{s.source}</span>
              </div>
              <p className="mt-0.5 text-xs text-zinc-400">{s.description}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

