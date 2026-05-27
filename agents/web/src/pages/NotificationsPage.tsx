import { useMemo, useState, type FormEvent } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Bell, Plus, Trash2 } from "lucide-react";
import {
  api,
  ApiError,
  type CreateChannelArgs,
  type NotificationChannel,
  type NotificationEventName,
} from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { ErrorBox } from "../components/ErrorBox.tsx";

const EVENT_LABELS: Record<NotificationEventName, string> = {
  run_succeeded: "Run succeeded",
  run_failed: "Run failed",
  approval_pending: "Approval pending",
  approval_failed: "Approval execution failed",
};

const TABS = ["Channels", "Subscriptions", "Deliveries"] as const;
type Tab = (typeof TABS)[number];

export function NotificationsPage() {
  const [tab, setTab] = useState<Tab>("Channels");

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Wire channels (console, webhook) to events (run failures, pending approvals). Deliveries are logged so you can debug what fired."
      />

      <div className="mb-4 flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950/40 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
              t === tab
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Channels" && <ChannelsTab />}
      {tab === "Subscriptions" && <SubscriptionsTab />}
      {tab === "Deliveries" && <DeliveriesTab />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

function ChannelsTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["notifications", "channels"],
    queryFn: api.notifications.listChannels,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.notifications.removeChannel(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "subscriptions"] });
    },
  });

  const test = useMutation({
    mutationFn: (id: string) => api.notifications.testChannel(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "deliveries"] });
    },
  });

  return (
    <>
      {showForm ? (
        <NewChannelForm
          senders={data?.senders ?? []}
          onDone={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mb-4 flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500"
        >
          <Plus className="size-4" />
          New channel
        </button>
      )}

      {isLoading && <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />}
      {error && <ErrorBox error={error} />}
      {data && data.channels.length === 0 && (
        <EmptyState
          icon={Bell}
          title="No channels configured"
          description="Add a channel (start with the console for testing) then subscribe events to it."
        />
      )}
      {data && data.channels.length > 0 && (
        <div className="flex flex-col gap-2">
          {data.channels.map((c) => (
            <div
              key={c.id}
              className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">
                      {c.kind}
                    </span>
                    <span className="text-sm font-medium text-zinc-100">
                      {c.displayName}
                    </span>
                  </div>
                  {Object.keys(c.configJson).length > 0 && (
                    <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-2 font-mono text-xs text-zinc-400">
                      {JSON.stringify(c.configJson, null, 2)}
                    </pre>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => test.mutate(c.id)}
                    disabled={test.isPending && test.variables === c.id}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                  >
                    {test.isPending && test.variables === c.id
                      ? "Sending…"
                      : "Test"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete channel "${c.displayName}"?`)) {
                        remove.mutate(c.id);
                      }
                    }}
                    className="flex items-center gap-1 rounded-md border border-rose-900/60 px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-950/40"
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </button>
                </div>
              </div>
              {test.isSuccess && test.variables === c.id && (
                <div className="mt-2 rounded border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
                  Test dispatched — check the Deliveries tab.
                </div>
              )}
              {test.isError && test.variables === c.id && (
                <div className="mt-2 rounded border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
                  {test.error instanceof ApiError
                    ? test.error.message
                    : String(test.error)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function NewChannelForm({
  senders,
  onDone,
  onCancel,
}: {
  senders: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState(senders[0] ?? "console");
  const [displayName, setDisplayName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (args: CreateChannelArgs) => api.notifications.createChannel(args),
    onSuccess: onDone,
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

  const needsUrl = kind === "webhook" || kind === "slack";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const configJson: Record<string, unknown> = needsUrl ? { url } : {};
    create.mutate({
      kind,
      displayName: displayName.trim(),
      configJson,
      secret: kind === "webhook" && secret ? secret : undefined,
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4"
    >
      <h3 className="mb-3 text-sm font-medium text-zinc-100">New channel</h3>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-400">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            {senders.length === 0 && <option value="console">console</option>}
            {senders.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-400">Display name</span>
          <input
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Server console"
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        </label>
        {needsUrl && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-400">
              {kind === "slack" ? "Slack incoming webhook URL" : "Webhook URL"}
            </span>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={
                kind === "slack"
                  ? "https://hooks.slack.com/services/T.../B.../..."
                  : "https://example.com/hooks/agents"
              }
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 font-mono"
            />
          </label>
        )}
        {kind === "webhook" && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-400">
              HMAC secret (optional, sent as x-agents-signature)
            </span>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 font-mono"
            />
          </label>
        )}
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
            {create.isPending ? "Saving…" : "Save"}
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

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

function SubscriptionsTab() {
  const queryClient = useQueryClient();
  const channels = useQuery({
    queryKey: ["notifications", "channels"],
    queryFn: api.notifications.listChannels,
  });
  const subs = useQuery({
    queryKey: ["notifications", "subscriptions"],
    queryFn: api.notifications.listSubscriptions,
  });

  const upsert = useMutation({
    mutationFn: (args: {
      event: NotificationEventName;
      channelId: string;
      enabled: boolean;
    }) => api.notifications.setSubscription(args.event, args.channelId, args.enabled),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["notifications", "subscriptions"],
      });
    },
  });

  const subMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of subs.data?.subscriptions ?? []) {
      m.set(`${s.event}:${s.channelId}`, s.enabled);
    }
    return m;
  }, [subs.data]);

  if (channels.isLoading || subs.isLoading) {
    return <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />;
  }
  if ((channels.data?.channels.length ?? 0) === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="Add a channel first"
        description="Subscriptions wire events (run failed, approval pending, …) to channels. Create one under the Channels tab, then come back here to flip on the events you want delivered."
      />
    );
  }

  const events: NotificationEventName[] =
    subs.data?.events ?? [
      "run_succeeded",
      "run_failed",
      "approval_pending",
      "approval_failed",
    ];

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-800 bg-zinc-950">
          <tr>
            <th className="px-4 py-2 text-left font-medium text-zinc-400">
              Event
            </th>
            {channels.data!.channels.map((c) => (
              <th
                key={c.id}
                className="px-4 py-2 text-left font-medium text-zinc-400"
              >
                {c.displayName}
                <span className="ml-1 font-mono text-[10px] text-zinc-500">
                  ({c.kind})
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr key={ev} className="border-b border-zinc-800 last:border-b-0">
              <td className="px-4 py-2 text-zinc-200">{EVENT_LABELS[ev]}</td>
              {channels.data!.channels.map((c) => {
                const enabled = subMap.get(`${ev}:${c.id}`) ?? false;
                return (
                  <td key={c.id} className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) =>
                        upsert.mutate({
                          event: ev,
                          channelId: c.id,
                          enabled: e.target.checked,
                        })
                      }
                      className="size-4 accent-emerald-500"
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

function DeliveriesTab() {
  const channels = useQuery({
    queryKey: ["notifications", "channels"],
    queryFn: api.notifications.listChannels,
  });
  const { data, isLoading, error } = useQuery({
    queryKey: ["notifications", "deliveries"],
    queryFn: api.notifications.listDeliveries,
    refetchInterval: 5_000,
  });

  const channelMap = useMemo(() => {
    const m = new Map<string, NotificationChannel>();
    for (const c of channels.data?.channels ?? []) m.set(c.id, c);
    return m;
  }, [channels.data]);

  if (isLoading) {
    return <div className="h-16 animate-pulse rounded-lg bg-zinc-900" />;
  }
  if (error) return <ErrorBox error={error} />;
  if (!data || data.deliveries.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="No deliveries yet"
        description="When a subscribed event fires, every delivery attempt logs here — successes and failures both."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
      {data.deliveries.map((d) => (
        <div
          key={d.id}
          className="grid grid-cols-[120px_160px_160px_1fr] items-center gap-3 border-b border-zinc-800 px-4 py-3 text-sm last:border-b-0"
        >
          <span className="font-mono text-xs text-zinc-500">
            {new Date(d.sentAt).toLocaleTimeString()}
          </span>
          <span className="font-mono text-xs text-zinc-400">{d.event}</span>
          <span className="truncate text-xs text-zinc-300">
            {channelMap.get(d.channelId)?.displayName ?? "(deleted)"}
          </span>
          <div className="flex items-center gap-2">
            <StatusBadge status={d.status} />
            {d.error && (
              <span className="truncate text-xs text-rose-300">
                {d.error}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
