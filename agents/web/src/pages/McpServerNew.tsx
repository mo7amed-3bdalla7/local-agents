import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api, ApiError, type CreateMcpServerArgs } from "../api.ts";
import { PageHeader } from "../components/PageHeader.tsx";

type Transport = "stdio" | "http" | "sse";

/** Parse one KEY=VALUE per line into an object; ignore blank / comment lines. */
function parseKVLines(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/** Same shape for `Name: Value` headers. */
function parseHeaderLines(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf(":");
    if (sep < 1) continue;
    out[trimmed.slice(0, sep).trim()] = trimmed.slice(sep + 1).trim();
  }
  return out;
}

export function McpServerNew() {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("stdio");

  // stdio
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");

  // http / sse
  const [url, setUrl] = useState("https://");
  const [headersText, setHeadersText] = useState("");

  const create = useMutation({
    mutationFn: (args: CreateMcpServerArgs) => api.mcp.create(args),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["mcp-servers"] });
      nav("/mcp-servers");
    },
  });

  const ready = (() => {
    if (!name.trim()) return false;
    if (transport === "stdio") return command.trim().length > 0;
    return /^https?:\/\/.+/.test(url.trim());
  })();

  const submit = () => {
    if (!ready) return;
    let configJson: Record<string, unknown>;
    if (transport === "stdio") {
      const args = argsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const env = parseKVLines(envText);
      configJson = {
        command: command.trim(),
        ...(args.length > 0 ? { args } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };
    } else {
      const headers = parseHeaderLines(headersText);
      configJson = {
        url: url.trim(),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
    }
    create.mutate({ name: name.trim(), transport, configJson });
  };

  return (
    <>
      <Link
        to="/mcp-servers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" /> MCP servers
      </Link>
      <PageHeader
        title="New MCP server"
        description="Register a Model Context Protocol server. Once registered, attach it to any agent and the SDK gets the server's tools at run time."
      />

      {create.error && (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {create.error instanceof ApiError
            ? create.error.message
            : String(create.error)}
        </div>
      )}

      <div className="max-w-2xl space-y-6">
        <Field label="Name" hint="unique; used as the MCP tool prefix">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-server"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500"
          />
        </Field>

        <Field label="Transport">
          <div className="grid grid-cols-3 gap-2">
            {(["stdio", "http", "sse"] as const).map((t) => (
              <label
                key={t}
                className={`flex cursor-pointer items-center justify-center gap-2 rounded border px-3 py-2 text-sm transition-colors ${
                  transport === t
                    ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-100"
                    : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
                }`}
              >
                <input
                  type="radio"
                  name="transport"
                  className="sr-only"
                  checked={transport === t}
                  onChange={() => setTransport(t)}
                />
                {t}
              </label>
            ))}
          </div>
        </Field>

        {transport === "stdio" ? (
          <>
            <Field label="Command" hint="absolute path or PATH-resolved">
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="/path/to/mcp-server-everything"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </Field>
            <Field label="Args" hint="one per line; optional">
              <textarea
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                rows={3}
                placeholder="--some-flag&#10;value"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500"
              />
            </Field>
            <Field
              label="Env"
              hint="KEY=VALUE per line; optional. Stored as plaintext in the row's configJson."
            >
              <textarea
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                rows={3}
                placeholder="DEBUG=1&#10;API_TIMEOUT=30"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500"
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="URL">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/v1"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </Field>
            <Field
              label="Headers"
              hint="Name: Value per line; optional. Stored as plaintext in the row's configJson."
            >
              <textarea
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                rows={3}
                placeholder="Authorization: Bearer ...&#10;X-Custom: value"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500"
              />
            </Field>
          </>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!ready || create.isPending}
          className="w-full rounded-md border border-emerald-500/60 bg-emerald-500/20 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
        >
          {create.isPending ? "Creating…" : "Create MCP server"}
        </button>
      </div>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {label}
        </span>
        {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
