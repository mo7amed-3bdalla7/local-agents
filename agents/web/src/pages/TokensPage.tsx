import { useState, type FormEvent } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import {
  api,
  ApiError,
  type ApiTokenSummary,
  type CreateTokenResponse,
} from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { ErrorBox } from "./AgentsList.tsx";

export function TokensPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [revealed, setRevealed] = useState<CreateTokenResponse | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["tokens"],
    queryFn: api.tokens.list,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.tokens.revoke(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
  });

  return (
    <>
      <PageHeader
        title="API tokens"
        description="Personal access tokens for programmatic access. Send as Authorization: Bearer <token> to authenticate against /api/* instead of using the session cookie."
      />

      {revealed && (
        <RevealedTokenCard
          token={revealed}
          onDismiss={() => setRevealed(null)}
        />
      )}

      {showForm && !revealed && (
        <NewTokenForm
          onCreated={(created) => {
            setRevealed(created);
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["tokens"] });
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {!showForm && !revealed && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mb-4 flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500"
        >
          <Plus className="size-4" />
          New token
        </button>
      )}

      {isLoading && (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.tokens.length === 0 && (
        <EmptyState
          icon={KeyRound}
          title="No tokens yet"
          description="Mint a token, copy it (it's shown once), then use it as `Authorization: Bearer <token>` in your scripts."
        />
      )}
      {data && data.tokens.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950">
              <tr className="text-left text-zinc-400">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Prefix</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Last used</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {data.tokens.map((t) => (
                <TokenRow
                  key={t.id}
                  token={t}
                  onRevoke={() => {
                    if (confirm(`Revoke "${t.name}"? This cannot be undone.`)) {
                      revoke.mutate(t.id);
                    }
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function tokenState(t: ApiTokenSummary): {
  label: string;
  klass: string;
} {
  if (t.revokedAt) {
    return {
      label: "revoked",
      klass: "bg-zinc-700/40 text-zinc-300 ring-zinc-500/30",
    };
  }
  if (t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now()) {
    return {
      label: "expired",
      klass: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
    };
  }
  return {
    label: "active",
    klass: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  };
}

function TokenRow({
  token,
  onRevoke,
}: {
  token: ApiTokenSummary;
  onRevoke: () => void;
}) {
  const state = tokenState(token);
  return (
    <tr className="border-b border-zinc-800 last:border-b-0">
      <td className="px-4 py-2 font-medium text-zinc-100">{token.name}</td>
      <td className="px-4 py-2 font-mono text-xs text-zinc-400">
        agt_{token.prefix}…
      </td>
      <td className="px-4 py-2 text-xs text-zinc-400">
        {new Date(token.createdAt).toLocaleString()}
      </td>
      <td className="px-4 py-2 text-xs text-zinc-400">
        {token.lastUsedAt
          ? new Date(token.lastUsedAt).toLocaleString()
          : "(never)"}
      </td>
      <td className="px-4 py-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${state.klass}`}
        >
          {state.label}
        </span>
      </td>
      <td className="px-4 py-2 text-right">
        {!token.revokedAt && (
          <button
            type="button"
            onClick={onRevoke}
            className="flex items-center gap-1 rounded-md border border-rose-900/60 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-950/40"
          >
            <Trash2 className="size-3.5" />
            Revoke
          </button>
        )}
      </td>
    </tr>
  );
}

function NewTokenForm({
  onCreated,
  onCancel,
}: {
  onCreated: (t: CreateTokenResponse) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.tokens.create({
        name: name.trim(),
        expiresAt: expiresAt || undefined,
      }),
    onSuccess: onCreated,
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Create failed",
      );
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4"
    >
      <h3 className="mb-3 text-sm font-medium text-zinc-100">New token</h3>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-400">Name</span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-cli"
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-400">
            Expires at (optional — leave blank for no expiry)
          </span>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        </label>
        {error && (
          <div className="rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

function RevealedTokenCard({
  token,
  onDismiss,
}: {
  token: CreateTokenResponse;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(token.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — fall through, user can still select-all manually
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/20 p-4">
      <div className="mb-2 text-sm font-medium text-amber-200">
        Copy this token now — it won't be shown again
      </div>
      <div className="mb-3 text-xs text-amber-300/80">
        Treat it like a password. Anyone with this string can act as you against the API.
      </div>
      <div className="mb-3 flex items-center gap-2">
        <code className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 break-all">
          {token.token}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
        >
          <Copy className="size-4" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <details className="mb-3 text-xs text-zinc-400">
        <summary className="cursor-pointer text-zinc-300">
          Example use
        </summary>
        <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-2 font-mono text-xs text-zinc-300">
{`curl -H "authorization: Bearer ${token.token}" http://localhost:3848/api/agents`}
        </pre>
      </details>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
      >
        I've saved it
      </button>
    </div>
  );
}
