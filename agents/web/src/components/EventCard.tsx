/**
 * Event rendering for the session timeline.
 *
 * The DB stores raw SDK messages in session_events.payload. They come in a few
 * recognizable shapes:
 *
 *   { type: "system", subtype: "init", model, cwd, ... }
 *   { type: "system", subtype: "hook_started" | "hook_response", ... }   (noisy)
 *   { type: "user",      message: { content: [...] } }                   incl. tool_results
 *   { type: "assistant", message: { content: [...] } }                   incl. text + tool_use
 *   { type: "result",    subtype: "success", result, duration_ms, ... }
 *
 * We render each into a small typed card so the timeline reads like a
 * conversation + tool log rather than a wall of JSON.
 */

import { useState } from "react";
import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronRight,
  CircuitBoard,
  CornerDownRight,
  FileText,
  Hammer,
  Sparkles,
  User,
} from "lucide-react";
import type { SessionEvent } from "../api.ts";

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
}

interface SdkMessage {
  type?: string;
  subtype?: string;
  message?: { content?: ContentBlock[] };
  model?: string;
  cwd?: string;
  session_id?: string;
  result?: string;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  is_error?: boolean;
  hook_name?: string;
  hook_event?: string;
}

export function EventCard({
  event,
  runLength = 1,
}: {
  event: SessionEvent;
  /** Number of consecutive identical events collapsed into this card. */
  runLength?: number;
}) {
  // Error / mcp_call / etc. kinds — render raw with their kind tag.
  if (event.kind !== "message") {
    return <RawCard event={event} />;
  }

  const p = (event.payload as unknown as SdkMessage) ?? {};

  if (p.type === "system") {
    return <SystemCard event={event} payload={p} runLength={runLength} />;
  }
  if (p.type === "user") {
    return <UserCard event={event} payload={p} />;
  }
  if (p.type === "assistant") {
    return <AssistantCard event={event} payload={p} />;
  }
  if (p.type === "result") {
    return <ResultCard event={event} payload={p} />;
  }
  return <RawCard event={event} />;
}

// ─── System (init + hooks — usually collapsed) ─────────────────────────────

function SystemCard({
  event,
  payload,
  runLength = 1,
}: {
  event: SessionEvent;
  payload: SdkMessage;
  runLength?: number;
}) {
  const isInit = payload.subtype === "init";
  const isHook = payload.subtype?.startsWith("hook_") ?? false;

  if (isInit) {
    return (
      <CardShell
        icon={<CircuitBoard className="size-3.5 text-blue-300" />}
        tone="border-blue-500/20 bg-blue-500/5"
        label="system init"
        ts={event.ts}
      >
        <div className="space-y-0.5 text-xs text-zinc-300">
          {payload.model && (
            <div>
              <span className="text-zinc-500">model:</span>{" "}
              <code className="font-mono">{payload.model}</code>
            </div>
          )}
          {payload.cwd && (
            <div className="truncate">
              <span className="text-zinc-500">cwd:</span>{" "}
              <code className="font-mono">{payload.cwd}</code>
            </div>
          )}
        </div>
      </CardShell>
    );
  }

  if (isHook) {
    const base = `hook · ${payload.hook_name ?? payload.subtype}`;
    const label = runLength > 1 ? `${base} ×${runLength}` : base;
    return (
      <CollapsibleCard
        icon={<CircuitBoard className="size-3.5 text-zinc-500" />}
        tone="border-zinc-800 bg-zinc-950/30"
        label={label}
        ts={event.ts}
        payload={event.payload}
      />
    );
  }

  // Other system messages — fall through to raw
  return <RawCard event={event} />;
}

// ─── Assistant (text + tool_use) ───────────────────────────────────────────

function AssistantCard({ event, payload }: { event: SessionEvent; payload: SdkMessage }) {
  const blocks = payload.message?.content ?? [];
  return (
    <CardShell
      icon={<Bot className="size-3.5 text-emerald-300" />}
      tone="border-emerald-500/20 bg-emerald-500/5"
      label="assistant"
      ts={event.ts}
    >
      <div className="space-y-2">
        {blocks.map((b, i) => (
          <AssistantBlock key={i} block={b} />
        ))}
      </div>
    </CardShell>
  );
}

function AssistantBlock({ block }: { block: ContentBlock }) {
  if (block.type === "text" && typeof block.text === "string") {
    return (
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-100">
        {block.text}
      </div>
    );
  }
  if (block.type === "tool_use") {
    return (
      <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-xs">
        <div className="flex items-center gap-1.5">
          <Hammer className="size-3 text-amber-300" />
          <span className="font-mono text-amber-200">{block.name}</span>
        </div>
        {block.input != null && (
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-zinc-400">
            {JSON.stringify(block.input, null, 2)}
          </pre>
        )}
      </div>
    );
  }
  if (block.type === "thinking") {
    // The SDK sends `block.thinking` (not `.text`) for thinking blocks,
    // plus a base64 `signature` we don't want to show.
    const body =
      (block as { thinking?: unknown }).thinking ??
      (block as { text?: unknown }).text;
    if (typeof body === "string" && body) {
      return (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
            <Sparkles className="mr-1 inline size-3" /> thinking
          </summary>
          <div className="mt-1 whitespace-pre-wrap break-words text-zinc-400">
            {body}
          </div>
        </details>
      );
    }
  }
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-zinc-400">
      {JSON.stringify(block, null, 2)}
    </pre>
  );
}

// ─── User (typically tool_result, sometimes a real prompt) ─────────────────

function UserCard({ event, payload }: { event: SessionEvent; payload: SdkMessage }) {
  const blocks = payload.message?.content ?? [];
  // If every block is a tool_result, render as a tool-output card. Otherwise
  // treat as a regular user-message card.
  const allToolResults =
    blocks.length > 0 && blocks.every((b) => b.type === "tool_result");

  if (allToolResults) {
    return (
      <CardShell
        icon={<CornerDownRight className="size-3.5 text-zinc-400" />}
        tone="border-zinc-800 bg-zinc-950/40"
        label="tool result"
        ts={event.ts}
      >
        <div className="space-y-2">
          {blocks.map((b, i) => (
            <ToolResultBlock key={i} block={b} />
          ))}
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell
      icon={<User className="size-3.5 text-zinc-400" />}
      tone="border-zinc-800 bg-zinc-950/40"
      label="user"
      ts={event.ts}
    >
      <div className="space-y-2">
        {blocks.map((b, i) => {
          if (b.type === "text" && typeof b.text === "string") {
            return (
              <div
                key={i}
                className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200"
              >
                {b.text}
              </div>
            );
          }
          return <ToolResultBlock key={i} block={b} />;
        })}
      </div>
    </CardShell>
  );
}

function ToolResultBlock({ block }: { block: ContentBlock }) {
  const text =
    typeof block.content === "string"
      ? block.content
      : Array.isArray(block.content)
        ? (block.content as Array<{ type?: string; text?: string }>)
            .map((c) => (c.type === "text" ? c.text ?? "" : JSON.stringify(c)))
            .join("\n")
        : JSON.stringify(block.content, null, 2);
  return (
    <div
      className={`rounded border px-2.5 py-1.5 text-xs ${
        block.is_error
          ? "border-rose-500/30 bg-rose-500/5 text-rose-200"
          : "border-zinc-800 bg-zinc-950 text-zinc-300"
      }`}
    >
      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
        {text}
      </pre>
    </div>
  );
}

// ─── Result (final summary) ─────────────────────────────────────────────────

function ResultCard({ event, payload }: { event: SessionEvent; payload: SdkMessage }) {
  const ok = !payload.is_error && payload.subtype === "success";
  return (
    <CardShell
      icon={
        ok ? (
          <FileText className="size-3.5 text-emerald-300" />
        ) : (
          <AlertCircle className="size-3.5 text-rose-300" />
        )
      }
      tone={
        ok
          ? "border-emerald-500/40 bg-emerald-500/10"
          : "border-rose-500/40 bg-rose-500/10"
      }
      label={`result · ${payload.subtype ?? "?"}`}
      ts={event.ts}
    >
      <div className="space-y-2">
        {typeof payload.result === "string" && (
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-100">
            {payload.result}
          </div>
        )}
        <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
          {payload.duration_ms != null && (
            <span>{(payload.duration_ms / 1000).toFixed(1)}s</span>
          )}
          {payload.num_turns != null && <span>{payload.num_turns} turns</span>}
          {payload.total_cost_usd != null && (
            <span>${payload.total_cost_usd.toFixed(4)}</span>
          )}
        </div>
      </div>
    </CardShell>
  );
}

// ─── Shared shells ─────────────────────────────────────────────────────────

function CardShell({
  icon,
  tone,
  label,
  ts,
  children,
}: {
  icon: React.ReactNode;
  tone: string;
  label: string;
  ts: string;
  children: React.ReactNode;
}) {
  return (
    <li className={`rounded-lg border p-3 ${tone}`}>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-mono uppercase tracking-wider text-zinc-400">
          {icon}
          {label}
        </span>
        <span className="text-zinc-500">
          {new Date(ts).toLocaleTimeString()}
        </span>
      </div>
      {children}
    </li>
  );
}

function CollapsibleCard({
  icon,
  tone,
  label,
  ts,
  payload,
}: {
  icon: React.ReactNode;
  tone: string;
  label: string;
  ts: string;
  payload: unknown;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`rounded-lg border ${tone}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-3 text-left text-xs hover:bg-zinc-900/30"
      >
        <span className="flex items-center gap-1.5 font-mono uppercase tracking-wider text-zinc-500">
          {open ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          {icon}
          {label}
        </span>
        <span className="text-zinc-600">
          {new Date(ts).toLocaleTimeString()}
        </span>
      </button>
      {open && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-zinc-800 p-3 text-[11px] leading-relaxed text-zinc-500">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </li>
  );
}

function RawCard({ event }: { event: SessionEvent }) {
  return (
    <CardShell
      icon={<CircuitBoard className="size-3.5 text-zinc-500" />}
      tone="border-zinc-800 bg-zinc-950/40"
      label={event.kind}
      ts={event.ts}
    >
      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-zinc-400">
        {JSON.stringify(event.payload, null, 2)}
      </pre>
    </CardShell>
  );
}
