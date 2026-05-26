import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Trash2, Wrench, Zap } from "lucide-react";
import { api, type McpServer, type McpTool, type TestResult } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { ErrorBox } from "./AgentsList.tsx";

export function McpServersList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: api.mcp.list,
  });

  return (
    <>
      <PageHeader
        title="MCP servers"
        description="Third-party tool providers. stdio / http / sse transports. Click a row to see the cached tools."
        actions={<AddButton />}
      />
      {isLoading && (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.mcpServers.length === 0 && (
        <EmptyState
          icon={Wrench}
          title="No MCP servers configured"
          description="Register one with `pnpm mcp add --name <n> --transport stdio --command <cmd>`. Then `pnpm mcp test --name <n>` probes tools/list and caches the result."
        />
      )}
      {data && data.mcpServers.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
          {data.mcpServers.map((m) => (
            <McpServerRow key={m.id} server={m} />
          ))}
        </div>
      )}
    </>
  );
}

function McpServerRow({ server }: { server: McpServer }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const tools = server.cachedToolsJson ?? [];
  const hasTools = tools.length > 0;

  const testMutation = useMutation({
    mutationFn: () => api.mcp.test(server.id),
    onSuccess: (r) => {
      setTest(r);
      // A successful test caches the tool list — refresh the row.
      queryClient.removeQueries({ queryKey: ["mcp-servers"] });
    },
    onError: (err) =>
      setTest({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.mcp.remove(server.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["mcp-servers"] });
    },
  });

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => hasTools && setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left disabled:cursor-default"
          disabled={!hasTools}
        >
          {hasTools ? (
            open ? (
              <ChevronDown className="size-4 text-zinc-500" />
            ) : (
              <ChevronRight className="size-4 text-zinc-500" />
            )
          ) : (
            <span className="size-4" />
          )}
          <div>
            <div className="text-sm font-medium text-zinc-100">{server.name}</div>
            <div className="text-xs text-zinc-500">{server.transport}</div>
          </div>
        </button>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>
            {hasTools
              ? `${tools.length} cached tool${tools.length === 1 ? "" : "s"}`
              : "(untested)"}
          </span>
          {server.cachedToolsFetchedAt && (
            <span title={new Date(server.cachedToolsFetchedAt).toLocaleString()}>
              tested {relativeTime(server.cachedToolsFetchedAt)}
            </span>
          )}
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
              if (confirm(`Delete MCP server "${server.name}"?`)) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
            className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
          >
            <Trash2 className="size-3" />
          </button>
          <span className="ml-1 text-zinc-500">
            {server.enabled ? "enabled" : "disabled"}
          </span>
        </div>
      </div>
      {test && !test.ok && (
        <div className="border-t border-zinc-800 px-4 py-2 text-xs text-rose-300">
          ✗ {test.message}
        </div>
      )}
      {test && test.ok && (
        <div className="border-t border-zinc-800 px-4 py-2 text-xs text-emerald-300">
          ✓ {test.message}
        </div>
      )}
      {open && hasTools && (
        <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-3">
          <ul className="space-y-1.5">
            {tools.map((t) => (
              <ToolRow key={t.name} tool={t} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ToolRow({ tool }: { tool: McpTool }) {
  return (
    <li className="text-xs">
      <div className="font-mono text-zinc-200">{tool.name}</div>
      {tool.description && (
        <div className="mt-0.5 text-zinc-500">{tool.description}</div>
      )}
    </li>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

function AddButton() {
  return (
    <Link
      to="/mcp-servers/new"
      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/60 bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-100 hover:bg-emerald-500/30"
    >
      <Plus className="size-4" /> New MCP server
    </Link>
  );
}
