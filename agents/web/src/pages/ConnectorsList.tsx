import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlugZap, Plus, Trash2, Zap } from "lucide-react";
import { api, type Connector, type TestResult } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { ErrorBox } from "../components/ErrorBox.tsx";

export function ConnectorsList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["connectors"],
    queryFn: api.connectors.list,
  });

  return (
    <>
      <PageHeader
        title="Connectors"
        description="First-party integrations (Jira so far; GitHub / Slack / WhatsApp slots in the schema). Per-instance config in Postgres + credential in the OS keychain."
        actions={
          <Link
            to="/connectors/new"
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/60 bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-100 hover:bg-emerald-500/30"
          >
            <Plus className="size-4" /> New connector
          </Link>
        }
      />
      {isLoading && (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.connectors.length === 0 && (
        <EmptyState
          icon={PlugZap}
          title="No connectors configured"
          description="Click `New connector` to add one. The credential goes straight into your OS keychain — only a ref is stored in Postgres."
        />
      )}
      {data && data.connectors.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
          {data.connectors.map((c) => (
            <ConnectorRow key={c.id} connector={c} />
          ))}
        </div>
      )}
    </>
  );
}

function ConnectorRow({ connector }: { connector: Connector }) {
  const queryClient = useQueryClient();
  const [test, setTest] = useState<TestResult | null>(null);

  const testMutation = useMutation({
    mutationFn: () => api.connectors.test(connector.id),
    onSuccess: (r) => setTest(r),
    onError: (err) =>
      setTest({ ok: false, message: err instanceof Error ? err.message : String(err) }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.connectors.remove(connector.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["connectors"] });
    },
  });

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <div className="text-sm font-medium text-zinc-100">
            {connector.displayName}
          </div>
          <div className="text-xs text-zinc-500">
            {connector.connectorType}
            {typeof connector.configJson.host === "string" && (
              <span className="ml-2 font-mono">
                · {String(connector.configJson.host)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            <Zap className="size-3" /> {testMutation.isPending ? "Testing…" : "Test"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                confirm(
                  `Delete connector "${connector.displayName}"? The keychain entry will be removed too.`,
                )
              ) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
            className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
          >
            <Trash2 className="size-3" />
          </button>
          <span className="ml-1 text-zinc-500">
            {connector.enabled ? "enabled" : "disabled"}
          </span>
        </div>
      </div>
      {test && (
        <div
          className={`border-t border-zinc-800 px-4 py-2 text-xs ${
            test.ok ? "text-emerald-300" : "text-rose-300"
          }`}
        >
          {test.ok ? "✓" : "✗"} {test.message}
        </div>
      )}
    </div>
  );
}
