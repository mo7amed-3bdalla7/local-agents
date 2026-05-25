import { useQuery } from "@tanstack/react-query";
import { PlugZap } from "lucide-react";
import { api } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { ErrorBox } from "./AgentsList.tsx";

export function ConnectorsList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["connectors"],
    queryFn: api.connectors.list,
  });

  return (
    <>
      <PageHeader
        title="Connectors"
        description="First-party integrations (Jira, GitHub, Slack, WhatsApp). Per-instance config + encrypted secret."
        actions={<AddButton />}
      />
      {isLoading && (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.connectors.length === 0 && (
        <EmptyState
          icon={PlugZap}
          title="No connectors configured"
          description="Connector packages land in a later commit. Once installed, add an instance here with its credentials."
        />
      )}
      {data && data.connectors.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
          {data.connectors.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 last:border-b-0"
            >
              <div>
                <div className="text-sm font-medium text-zinc-100">
                  {c.displayName}
                </div>
                <div className="text-xs text-zinc-500">{c.connectorType}</div>
              </div>
              <span className="text-xs text-zinc-500">
                {c.enabled ? "enabled" : "disabled"}
              </span>
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
      title="Connector packages land in a later commit"
      className="cursor-not-allowed rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-500"
    >
      + Add (soon)
    </button>
  );
}
