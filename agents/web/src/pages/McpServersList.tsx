import { useQuery } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { api } from "../api.ts";
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
        description="Third-party tool providers. stdio / http / sse transports."
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
          description="The MCP registry lands in a later commit. Configure a transport + credentials, ping tools/list, enable per agent."
        />
      )}
      {data && data.mcpServers.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
          {data.mcpServers.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 last:border-b-0"
            >
              <div>
                <div className="text-sm font-medium text-zinc-100">
                  {m.name}
                </div>
                <div className="text-xs text-zinc-500">{m.transport}</div>
              </div>
              <span className="text-xs text-zinc-500">
                {m.enabled ? "enabled" : "disabled"}
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
      title="MCP registry lands in a later commit"
      className="cursor-not-allowed rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-500"
    >
      + Add (soon)
    </button>
  );
}
