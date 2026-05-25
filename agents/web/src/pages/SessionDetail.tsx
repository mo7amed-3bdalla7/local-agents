import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api, type SessionEvent } from "../api.ts";
import { PageHeader } from "../components/PageHeader.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { ErrorBox } from "./AgentsList.tsx";

export function SessionDetail() {
  const { id = "" } = useParams();
  const sessionQuery = useQuery({
    queryKey: ["session", id],
    queryFn: () => api.sessions.get(id),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      query.state.data?.session.status === "active" ? 2000 : false,
  });
  const isActive = sessionQuery.data?.session.status === "active";
  const eventsQuery = useQuery({
    queryKey: ["session-events", id],
    queryFn: () => api.sessions.events(id),
    enabled: Boolean(id),
    refetchInterval: isActive ? 2000 : false,
  });

  if (sessionQuery.error) return <ErrorBox error={sessionQuery.error} />;
  if (!sessionQuery.data) {
    return <div className="h-24 animate-pulse rounded-lg bg-zinc-900" />;
  }

  const { session } = sessionQuery.data;
  const events = eventsQuery.data?.events ?? [];

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

function EventCard({ event }: { event: SessionEvent }) {
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono uppercase tracking-wider text-zinc-300">
          {event.kind}
        </span>
        <span className="text-zinc-500">
          {new Date(event.ts).toLocaleTimeString()}
        </span>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-zinc-400">
        {JSON.stringify(event.payload, null, 2)}
      </pre>
    </li>
  );
}
