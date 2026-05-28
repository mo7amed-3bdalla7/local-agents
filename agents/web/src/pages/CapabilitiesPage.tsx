import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Boxes, Hammer } from "lucide-react";
import {
  api,
  type ExecutorSpec,
  type FieldSpec,
  type SenderSpec,
} from "../api.ts";
import { ErrorBox } from "../components/ErrorBox.tsx";
import { PageHeader } from "../components/PageHeader.tsx";

export function CapabilitiesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["capabilities"],
    queryFn: api.capabilities.list,
  });

  const executorsByCategory = useMemo(() => {
    const m = new Map<string, ExecutorSpec[]>();
    for (const e of data?.executors ?? []) {
      const arr = m.get(e.category) ?? [];
      arr.push(e);
      m.set(e.category, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  return (
    <>
      <PageHeader
        title="Capabilities"
        description="Every side effect your agents can stage (executors) and every notification transport (senders). Use these payload shapes when you write an agent prompt that calls propose_action, or when you set up a notification channel."
      />

      {isLoading && (
        <div className="h-32 animate-pulse rounded-lg bg-zinc-900" />
      )}
      {error && <ErrorBox error={error} />}

      {data && (
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
              <Hammer className="size-4 text-amber-300" />
              Executors — propose_action kinds
            </div>
            <p className="mb-4 text-sm text-zinc-500">
              Agents stage these by calling{" "}
              <code className="rounded bg-zinc-900 px-1 font-mono text-xs text-zinc-300">
                propose_action({"{kind, title, description, payload}"})
              </code>
              . A human reviews on Approvals before the executor runs.
            </p>
            <div className="space-y-6">
              {executorsByCategory.map(([cat, items]) => (
                <div key={cat}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {cat}
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {items.map((e) => (
                      <ExecutorCard key={e.kind} spec={e} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
              <Bell className="size-4 text-emerald-300" />
              Senders — notification channel kinds
            </div>
            <p className="mb-4 text-sm text-zinc-500">
              Configure these under{" "}
              <a href="/notifications" className="text-emerald-400 hover:underline">
                Notifications
              </a>{" "}
              by creating a channel of the given kind with the listed config.
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {data.senders.map((s) => (
                <SenderCard key={s.kind} spec={s} />
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ExecutorCard({ spec }: { spec: ExecutorSpec }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-1 flex items-center gap-2">
        <Boxes className="size-4 text-amber-300" />
        <code className="font-mono text-sm font-medium text-zinc-100">
          {spec.kind}
        </code>
        <RegisteredBadge registered={spec.registered} />
      </div>
      <p className="mb-3 text-sm text-zinc-400">{spec.description}</p>
      <FieldsTable fields={spec.payload} />
      {spec.notes && (
        <p className="mt-2 text-xs text-zinc-500 italic">{spec.notes}</p>
      )}
      <ExampleBlock label="Example payload" obj={spec.example} />
    </div>
  );
}

function SenderCard({ spec }: { spec: SenderSpec }) {
  return (
    <div className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-1 flex items-center gap-2">
        <Bell className="size-4 text-emerald-300" />
        <code className="font-mono text-sm font-medium text-zinc-100">
          {spec.kind}
        </code>
        <RegisteredBadge registered={spec.registered} />
      </div>
      <p className="mb-3 text-sm text-zinc-400">{spec.description}</p>
      {spec.config.length > 0 ? (
        <FieldsTable fields={spec.config} />
      ) : (
        <div className="text-xs text-zinc-500">No config required.</div>
      )}
      {spec.secret && (
        <p className="mt-2 text-xs text-zinc-500">
          <span className="font-semibold text-zinc-400">Secret:</span>{" "}
          {spec.secret}
        </p>
      )}
      <ExampleBlock label="Example configJson" obj={spec.exampleConfig} />
    </div>
  );
}

function FieldsTable({ fields }: { fields: FieldSpec[] }) {
  if (fields.length === 0) return null;
  return (
    <table className="w-full text-xs">
      <tbody>
        {fields.map((f) => (
          <tr
            key={f.name}
            className="border-b border-zinc-800 last:border-b-0 align-top"
          >
            <td className="py-1 pr-2 font-mono text-zinc-300">
              {f.name}
              {f.required && (
                <span className="ml-0.5 text-rose-400">*</span>
              )}
            </td>
            <td className="py-1 pr-2 font-mono text-[11px] text-zinc-500">
              {f.type}
            </td>
            <td className="py-1 text-zinc-400">{f.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExampleBlock({
  label,
  obj,
}: {
  label: string;
  obj: Record<string, unknown>;
}) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
        {label}
      </summary>
      <pre className="mt-1 overflow-x-auto rounded bg-zinc-900 p-2 font-mono text-[11px] text-zinc-300">
        {JSON.stringify(obj, null, 2)}
      </pre>
    </details>
  );
}

function RegisteredBadge({ registered }: { registered: boolean }) {
  return registered ? (
    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
      registered
    </span>
  ) : (
    <span
      className="rounded bg-zinc-700/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-300 ring-1 ring-inset ring-zinc-500/30"
      title="Documented but not currently active on this server"
    >
      not registered
    </span>
  );
}
