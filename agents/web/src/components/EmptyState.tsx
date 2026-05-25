import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: typeof Inbox;
  action?: ReactNode;
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/50 px-6 py-12 text-center">
      <Icon className="mb-3 size-8 text-zinc-600" />
      <div className="mb-1 text-sm font-medium text-zinc-200">{title}</div>
      {description && (
        <div className="max-w-md text-sm text-zinc-500">{description}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
