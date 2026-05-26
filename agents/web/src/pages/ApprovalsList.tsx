import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Check, ShieldCheck, X } from "lucide-react";
import {
  api,
  type PendingAction,
  type PendingActionStatus,
} from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { ErrorBox } from "./AgentsList.tsx";

const TABS: { label: string; statuses: PendingActionStatus[] }[] = [
  { label: "Pending", statuses: ["pending"] },
  { label: "Executed", statuses: ["executed"] },
  { label: "Rejected", statuses: ["rejected"] },
  { label: "Failed", statuses: ["failed"] },
];

export function ApprovalsList() {
  const [tab, setTab] = useState(0);
  const statuses = TABS[tab].statuses;
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["approvals", statuses.join(",")],
    queryFn: () => api.approvals.list(statuses),
    refetchInterval: tab === 0 ? 3_000 : false,
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.approvals.approve(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) => api.approvals.reject(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
  });

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Side-effecting actions agents want to take (PR comments, commits, messages) wait here for your sign-off before they run."
      />

      <div className="mb-4 flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950/40 p-1">
        {TABS.map((t, i) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setTab(i)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
              i === tab
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}

      {data && data.approvals.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title={
            tab === 0
              ? "Nothing waiting for approval"
              : `No ${TABS[tab].label.toLowerCase()} actions`
          }
          description={
            tab === 0
              ? "When an agent drafts a side effect (a comment, a commit, a Slack message) it lands here for you to approve or reject."
              : "History will appear here once agents start proposing actions."
          }
        />
      )}

      {data && data.approvals.length > 0 && (
        <div className="flex flex-col gap-2">
          {data.approvals.map((a) => (
            <ApprovalCard
              key={a.id}
              action={a}
              canAct={a.status === "pending"}
              busy={
                (approve.isPending && approve.variables === a.id) ||
                (reject.isPending && reject.variables === a.id)
              }
              error={
                approve.variables === a.id && approve.error instanceof Error
                  ? approve.error.message
                  : reject.variables === a.id && reject.error instanceof Error
                    ? reject.error.message
                    : null
              }
              onApprove={() => approve.mutate(a.id)}
              onReject={() => reject.mutate(a.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

interface ApprovalCardProps {
  action: PendingAction;
  canAct: boolean;
  busy: boolean;
  error: string | null;
  onApprove: () => void;
  onReject: () => void;
}

function ApprovalCard({
  action,
  canAct,
  busy,
  error,
  onApprove,
  onReject,
}: ApprovalCardProps) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">
              {action.kind}
            </span>
            <StatusBadge status={action.status} />
            <span className="text-xs text-zinc-500">
              {new Date(action.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="mb-2 truncate text-sm font-medium text-zinc-100">
            {action.title}
          </div>
          {action.description && (
            <div className="mb-3 text-sm text-zinc-400">
              {action.description}
            </div>
          )}
          <details className="text-xs text-zinc-500">
            <summary className="cursor-pointer hover:text-zinc-300">
              payload
            </summary>
            <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-2 font-mono text-xs text-zinc-300">
              {JSON.stringify(action.payload, null, 2)}
            </pre>
          </details>
          {action.executorResult && (
            <details className="mt-2 text-xs text-zinc-500">
              <summary className="cursor-pointer hover:text-zinc-300">
                executor result
              </summary>
              <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-2 font-mono text-xs text-emerald-200">
                {JSON.stringify(action.executorResult, null, 2)}
              </pre>
            </details>
          )}
          {action.executorError && (
            <div className="mt-2 rounded border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-300">
              {action.executorError}
            </div>
          )}
          {error && (
            <div className="mt-2 rounded border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-300">
              {error}
            </div>
          )}
        </div>

        {canAct && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onApprove}
              disabled={busy}
              className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="size-4" />
              Approve
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={busy}
              className="flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="size-4" />
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

