import { useQuery } from "@tanstack/react-query";
import { GitPullRequest } from "lucide-react";
import { api } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { ErrorBox } from "../components/ErrorBox.tsx";

export function PrActivityList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pr-activity"],
    queryFn: api.prActivity.list,
  });

  return (
    <>
      <PageHeader
        title="PR activity"
        description="Unified audit log of comments posted and commits pushed by agents under your GitHub identity."
      />
      {isLoading && (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.prActivity.length === 0 && (
        <EmptyState
          icon={GitPullRequest}
          title="No PR activity yet"
          description="Every comment the outgoing-review agent drafts and every commit the incoming-review agent pushes will show up here, with its GitHub link and SHA."
        />
      )}
      {data && data.prActivity.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
          {data.prActivity.map((p) => (
            <div
              key={p.id}
              className="grid grid-cols-[120px_140px_1fr_160px] items-center gap-3 border-b border-zinc-800 px-4 py-3 text-sm last:border-b-0"
            >
              <span className="font-mono text-xs text-zinc-400">
                #{p.prNumber}
              </span>
              <span className="text-xs text-zinc-400">{p.kind}</span>
              <span className="truncate text-xs text-zinc-500">
                {p.githubUrl ?? "(not posted)"}
              </span>
              <StatusBadge status={p.status} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
