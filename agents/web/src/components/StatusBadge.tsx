interface StatusBadgeProps {
  status: string;
}

const COLORS: Record<string, string> = {
  active: "bg-blue-500/20 text-blue-300 ring-blue-500/30",
  pending: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  success: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  completed: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  posted: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  failure: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  failed: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  timeout: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
  aborted: "bg-zinc-600/30 text-zinc-300 ring-zinc-500/30",
  drafted: "bg-zinc-700/40 text-zinc-300 ring-zinc-500/30",
  pending_approval: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  approved: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
  rejected: "bg-zinc-700/40 text-zinc-300 ring-zinc-500/30",
  executed: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  sent: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  enabled: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  disabled: "bg-zinc-700/40 text-zinc-300 ring-zinc-500/30",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const klass = COLORS[status] ?? "bg-zinc-700/40 text-zinc-300 ring-zinc-500/30";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${klass}`}
    >
      {status}
    </span>
  );
}
