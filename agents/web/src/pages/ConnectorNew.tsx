import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api, ApiError, type CreateConnectorArgs } from "../api.ts";
import { PageHeader } from "../components/PageHeader.tsx";

// Slice-4 ships Jira only — the platform's other connector slots in the
// schema (github, slack, whatsapp) still need their per-type clients.
const SUPPORTED_TYPES = ["jira"] as const;
type ConnectorType = (typeof SUPPORTED_TYPES)[number];

export function ConnectorNew() {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const [type, setType] = useState<ConnectorType>("jira");
  const [displayName, setDisplayName] = useState("");

  // Jira fields
  const [host, setHost] = useState("https://");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");

  const create = useMutation({
    mutationFn: (args: CreateConnectorArgs) => api.connectors.create(args),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["connectors"] });
      nav("/connectors");
    },
  });

  const trimmedHost = host.replace(/\/$/, "");
  const hostValid = /^https?:\/\/.+/.test(trimmedHost);
  const ready =
    displayName.trim().length > 0 &&
    hostValid &&
    email.includes("@") &&
    token.length > 0;

  const submit = () => {
    if (!ready) return;
    create.mutate({
      connectorType: type,
      displayName: displayName.trim(),
      configJson: { host: trimmedHost, email: email.trim() },
      secret: token,
    });
  };

  return (
    <>
      <Link
        to="/connectors"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" /> Connectors
      </Link>
      <PageHeader
        title="New connector"
        description="Add a first-party integration. The credential goes straight into your OS keychain — only the keychain ref is persisted in the DB."
      />

      {create.error && (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {create.error instanceof ApiError
            ? create.error.message
            : String(create.error)}
        </div>
      )}

      <div className="max-w-2xl space-y-6">
        <Field label="Type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ConnectorType)}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          >
            {SUPPORTED_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Display name" hint="how it shows up in the registry">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="My Jira"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          />
        </Field>

        {type === "jira" && (
          <>
            <Field label="Host" hint="https://<your-tenant>.atlassian.net">
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="https://my-cloud.atlassian.net"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
              {host && !hostValid && (
                <div className="mt-1 text-xs text-amber-400">
                  must start with http(s)://
                </div>
              )}
            </Field>

            <Field label="Email" hint="login email for API auth">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="me@my-cloud.com"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </Field>

            <Field
              label="API token"
              hint="from id.atlassian.com — stored in OS keychain only"
            >
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500"
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
          {create.isPending ? "Creating…" : "Create connector"}
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
