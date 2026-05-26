import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { api } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { ErrorBox } from "./AgentsList.tsx";

const WINDOWS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

export function UsagePage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error } = useQuery({
    queryKey: ["usage", days],
    queryFn: () => api.usage.get(days),
    refetchInterval: 10_000,
  });

  return (
    <>
      <PageHeader
        title="Usage"
        description="Token and cost rollups across all agents. Captured from the SDK's final result message on every successful run."
        actions={
          <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                type="button"
                onClick={() => setDays(w.days)}
                className={`rounded px-2 py-1 transition-colors ${
                  days === w.days
                    ? "bg-emerald-500/20 text-emerald-100"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        }
      />

      {isLoading && (
        <div className="h-32 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}
      {data && data.totals.runs === 0 && (
        <EmptyState
          icon={BarChart3}
          title="No runs in this window"
          description="Token + cost numbers populate after a successful run completes. Trigger an agent (Run Now, cron, webhook, …) and refresh."
        />
      )}

      {data && data.totals.runs > 0 && (
        <div className="space-y-6">
          <TotalsRow data={data} />
          <PerDayChart data={data} />
          <PerAgentTable data={data} />
        </div>
      )}
    </>
  );
}

function TotalsRow({ data }: { data: NonNullable<ReturnType<typeof api.usage.get> extends Promise<infer T> ? T : never> }) {
  const { totals } = data;
  const tiles = [
    { label: "Runs", value: totals.runs.toLocaleString() },
    {
      label: "Success rate",
      value:
        totals.runs > 0
          ? `${Math.round((totals.successes / totals.runs) * 100)}%`
          : "—",
    },
    {
      label: "Cost",
      value: `$${totals.costUsd.toFixed(4)}`,
      hint: `(${data.windowDays}d)`,
    },
    {
      label: "Tokens",
      value: (totals.inputTokens + totals.outputTokens).toLocaleString(),
      hint: `${totals.inputTokens.toLocaleString()} in / ${totals.outputTokens.toLocaleString()} out`,
    },
    {
      label: "Cache reads",
      value: totals.cacheReadTokens.toLocaleString(),
      hint: "prompt cache hits",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3"
        >
          <div className="text-xs uppercase tracking-wider text-zinc-500">
            {t.label}
          </div>
          <div className="mt-1 text-2xl font-medium text-zinc-100">
            {t.value}
          </div>
          {t.hint && (
            <div className="mt-0.5 text-[11px] text-zinc-500">{t.hint}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function PerDayChart({ data }: { data: NonNullable<ReturnType<typeof api.usage.get> extends Promise<infer T> ? T : never> }) {
  // Sort ascending for left-to-right time axis.
  const days = [...data.perDay].sort((a, b) => a.day.localeCompare(b.day));
  const maxCost = Math.max(...days.map((d) => Number(d.costUsd)), 0.0001);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Cost by day
      </h3>
      <div className="flex h-32 items-end gap-1">
        {days.map((d) => {
          const cost = Number(d.costUsd);
          const heightPct = (cost / maxCost) * 100;
          return (
            <div
              key={d.day}
              className="group relative flex flex-1 flex-col items-center"
              title={`${d.day} — $${cost.toFixed(4)} · ${d.runs} runs`}
            >
              <div
                className="w-full rounded-t bg-emerald-500/40 hover:bg-emerald-500/60"
                style={{ height: `${Math.max(heightPct, 2)}%` }}
              />
              <div className="mt-1 truncate text-[10px] text-zinc-500">
                {d.day.slice(5)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PerAgentTable({ data }: { data: NonNullable<ReturnType<typeof api.usage.get> extends Promise<infer T> ? T : never> }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900/50 text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Agent</th>
            <th className="px-4 py-2 text-right font-medium">Runs</th>
            <th className="px-4 py-2 text-right font-medium">Success</th>
            <th className="px-4 py-2 text-right font-medium">Input tok</th>
            <th className="px-4 py-2 text-right font-medium">Output tok</th>
            <th className="px-4 py-2 text-right font-medium">Cache read</th>
            <th className="px-4 py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {data.perAgent.map((a) => {
            const successRate =
              a.runs > 0 ? Math.round((a.successes / a.runs) * 100) : 0;
            return (
              <tr key={a.agentId} className="border-t border-zinc-800">
                <td className="px-4 py-2 font-mono text-zinc-200">
                  {a.agentName ?? "(deleted)"}
                </td>
                <td className="px-4 py-2 text-right text-zinc-300">{a.runs}</td>
                <td className="px-4 py-2 text-right">
                  <span
                    className={
                      successRate >= 90
                        ? "text-emerald-300"
                        : successRate >= 50
                          ? "text-amber-300"
                          : "text-rose-300"
                    }
                  >
                    {successRate}%
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-zinc-400">
                  {a.inputTokens.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-zinc-400">
                  {a.outputTokens.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-zinc-500">
                  {a.cacheReadTokens.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right font-mono text-zinc-100">
                  ${Number(a.costUsd).toFixed(4)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
