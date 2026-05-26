import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { api, type McpServer, type McpTool } from "../api.ts";
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
  const [open, setOpen] = useState(false);
  const tools = server.cachedToolsJson ?? [];
  const hasTools = tools.length > 0;

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <button
        type="button"
        onClick={() => hasTools && setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-zinc-900/40"
        disabled={!hasTools}
      >
        <div className="flex items-center gap-2">
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
        </div>
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
          <span>{server.enabled ? "enabled" : "disabled"}</span>
        </div>
      </button>
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
    <button
      type="button"
      disabled
      title="Use the CLI: pnpm mcp add ..."
      className="cursor-not-allowed rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-500"
    >
      + Add (CLI only)
    </button>
  );
}
