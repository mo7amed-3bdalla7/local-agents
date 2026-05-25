import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { ErrorBox } from "./AgentsList.tsx";

export function SkillsList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["skills"],
    queryFn: api.skills.list,
  });

  return (
    <>
      <PageHeader
        title="Skills"
        description="Folders with a SKILL.md. Imported from local paths or git URLs, enabled per agent."
        actions={<AddButton />}
      />
      {isLoading && (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.skills.length === 0 && (
        <EmptyState
          icon={Sparkles}
          title="No skills installed"
          description="The skill registry lands in a later commit. It will scan .claude/skills/*/SKILL.md and let you import more from git."
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

function AddButton() {
  return (
    <button
      type="button"
      disabled
      title="Skill registry lands in a later commit"
      className="cursor-not-allowed rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-500"
    >
      + Import (soon)
    </button>
  );
}
