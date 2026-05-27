import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api, type SessionEvent } from "../api.ts";
import { EventCard } from "../components/EventCard.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { ErrorBox } from "../components/ErrorBox.tsx";

export function SessionDetail() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();

  // The session row (status, started/finished) still comes from a regular
  // fetch; the SSE stream carries events only, plus a `done` notifier that
  // flips status when the session ends.
  const sessionQuery = useQuery({
    queryKey: ["session", id],
    queryFn: () => api.sessions.get(id),
    enabled: Boolean(id),
  });

  // Events live in local component state, appended to as the SSE channel
  // pushes them. Open the stream once per id; close on unmount or `done`.
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setEvents([]);
    setStreamError(null);

    const es = new EventSource(`/api/sessions/${id}/stream`);

    es.addEventListener("event", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as SessionEvent;
        setEvents((prev) => [...prev, data]);
      } catch {
        // ignore malformed
      }
    });

    es.addEventListener("done", () => {
      es.close();
      // Refetch the session row so the badge flips active → completed/etc.
      queryClient.invalidateQueries({ queryKey: ["session", id] });
    });

    es.addEventListener("error", (e) => {
      // SSE auto-reconnects on transport errors; only flag the user-facing
      // error event we emit when the session is missing.
      const msg = (e as MessageEvent).data;
      if (typeof msg === "string") {
        try {
          const parsed = JSON.parse(msg);
          if (parsed && typeof parsed.error === "string") {
            setStreamError(parsed.error);
            es.close();
          }
        } catch {
          // ignore
        }
      }
    });

    return () => es.close();
  }, [id, queryClient]);

  if (sessionQuery.error) return <ErrorBox error={sessionQuery.error} />;
  if (!sessionQuery.data) {
    return <div className="h-24 animate-pulse rounded-lg bg-zinc-900" />;
  }

  const { session } = sessionQuery.data;

  return (
    <>
      <Link
        to="/sessions"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" /> Sessions
      </Link>
      <PageHeader
        title={`Session ${session.id.slice(0, 8)}`}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={session.status} />
            <span>
              started {new Date(session.startedAt).toLocaleString()}
              {session.finishedAt &&
                ` · finished ${new Date(session.finishedAt).toLocaleString()}`}
            </span>
          </span>
        }
      />

      {streamError && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          stream: {streamError}
        </div>
      )}

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Timeline ({events.length})
      </h3>
      {events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-6 text-center text-sm text-zinc-500">
          No events recorded.
        </div>
      ) : (
        <ol className="space-y-2">
          {events.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </ol>
      )}
    </>
  );
}

