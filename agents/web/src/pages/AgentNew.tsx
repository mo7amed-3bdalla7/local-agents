import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Sparkles, X } from "lucide-react";
import {
  api,
  ApiError,
  type CreateAgentArgs,
  type GeneratedAgentDraft,
} from "../api.ts";
import { PageHeader } from "../components/PageHeader.tsx";

const DEFAULT_PROMPT = `# Your Agent

## Purpose

What this agent does in one paragraph.

## Persona

How it behaves, its tone, its constraints.

## Workflow

Step-by-step instructions for the agent's workflow.
`;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function AgentNew() {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [maxTurns, setMaxTurns] = useState(10);
  const [timeoutSec, setTimeoutSec] = useState(300);
  const [tools, setTools] = useState<Set<string>>(
    new Set(["Read", "Bash", "Glob", "Grep"]),
  );
  const [showGenerator, setShowGenerator] = useState(false);
  /** Fields from a generated draft that aren't editable in this form (triggers,
   *  dryRun, maxCostUsd, etc.). Merged into configJson on save. */
  const [draftExtras, setDraftExtras] = useState<Record<string, unknown>>({});
  const [draftConnectors, setDraftConnectors] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: (args: CreateAgentArgs) => api.agents.create(args),
    onSuccess: ({ agent }) => {
      // Wipe the cached list entirely so the next AgentsList mount triggers a
      // fresh fetch. invalidateQueries/refetchQueries only fire when observers
      // are active, and the list is unmounted while we're on /agents/new.
      queryClient.removeQueries({ queryKey: ["agents"] });
      nav(`/agents/${agent.id}`);
    },
  });

  const nameValid = NAME_PATTERN.test(name);
  const ready = nameValid && description.trim().length > 0;

  const toggleTool = (t: string) => {
    setTools((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  };

  const submit = () => {
    if (!ready) return;
    // Carry any draft-only fields (triggers, prompt, dryRun, maxCostUsd, …)
    // that the form doesn't currently expose for editing. Execution fields
    // we own get re-stamped from the form state below.
    const draftExecution =
      (draftExtras.execution as Record<string, unknown> | undefined) ?? {};
    create.mutate({
      name,
      description: description.trim(),
      systemPrompt,
      configJson: {
        ...draftExtras,
        execution: {
          ...draftExecution,
          model,
          tools: Array.from(tools),
          maxTurns,
          timeoutMs: timeoutSec * 1000,
          permissionMode: "acceptEdits",
        },
      },
    });
  };

  function applyDraft(draft: GeneratedAgentDraft) {
    setName(draft.name);
    setDescription(draft.description);
    setSystemPrompt(draft.systemPrompt);
    const cfg = (draft.configJson ?? {}) as Record<string, unknown>;
    const exec =
      (cfg.execution as Record<string, unknown> | undefined) ?? {};
    if (typeof exec.model === "string") setModel(exec.model);
    if (typeof exec.maxTurns === "number") setMaxTurns(exec.maxTurns);
    if (typeof exec.timeoutMs === "number") {
      setTimeoutSec(Math.round(exec.timeoutMs / 1000));
    }
    if (Array.isArray(exec.tools)) {
      setTools(new Set(exec.tools.filter((t): t is string => typeof t === "string")));
    }
    // Stash anything we don't surface in the form so save round-trips it.
    setDraftExtras(cfg);
    setDraftConnectors(draft.recommendedConnectors ?? []);
    setShowGenerator(false);
  }

  return (
    <>
      <Link
        to="/agents"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" /> Agents
      </Link>
      <PageHeader
        title="New agent"
        description="Create an agent that lives in the platform's DB. Edit the system prompt freely — file-defined agents stay file-defined."
        actions={
          <button
            type="button"
            onClick={() => setShowGenerator(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-sm font-medium text-violet-200 hover:bg-violet-500/20"
          >
            <Sparkles className="size-4" />
            Generate with AI
          </button>
        }
      />

      {draftConnectors.length > 0 && (
        <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs text-blue-200">
          AI suggested connectors:{" "}
          {draftConnectors.map((c) => (
            <span
              key={c}
              className="mr-1 inline-flex rounded bg-blue-500/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide"
            >
              {c}
            </span>
          ))}
          <span className="text-blue-300/70">
            — set them up under Connectors, then attach on the agent's detail page after save.
          </span>
        </div>
      )}

      {create.error && (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {create.error instanceof ApiError
            ? create.error.message
            : String(create.error)}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Field label="Name" hint="lowercase, hyphens; max 63 chars">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-agent"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
            {name && !nameValid && (
              <div className="mt-1 text-xs text-amber-400">
                must start with a letter or digit, only [a-z0-9-]
              </div>
            )}
          </Field>

          <Field label="Description" hint="shown in the agents list">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this agent does in one sentence."
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
          </Field>

          <Field label="System prompt" hint="written to AGENTS.md on first run">
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={18}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-100 outline-none focus:border-emerald-500"
            />
          </Field>
        </div>

        <div className="space-y-6">
          <Field label="Model">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            >
              <option value="claude-opus-4-7">claude-opus-4-7</option>
              <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
              <option value="claude-haiku-4-5">claude-haiku-4-5</option>
            </select>
          </Field>

          <Field label="Max turns">
            <input
              type="number"
              min={1}
              max={100}
              value={maxTurns}
              onChange={(e) => setMaxTurns(Number(e.target.value))}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
          </Field>

          <Field label="Timeout (s)">
            <input
              type="number"
              min={10}
              max={3600}
              value={timeoutSec}
              onChange={(e) => setTimeoutSec(Number(e.target.value))}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
          </Field>

          <Field label="SDK tools">
            <div className="grid grid-cols-2 gap-1.5 text-sm">
              {["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebFetch", "WebSearch"].map((t) => (
                <label
                  key={t}
                  className="flex cursor-pointer items-center gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-xs"
                >
                  <input
                    type="checkbox"
                    className="size-3.5 cursor-pointer accent-emerald-500"
                    checked={tools.has(t)}
                    onChange={() => toggleTool(t)}
                  />
                  <span className="font-mono text-zinc-200">{t}</span>
                </label>
              ))}
            </div>
          </Field>

          <button
            type="button"
            onClick={submit}
            disabled={!ready || create.isPending}
            className="w-full rounded-md border border-emerald-500/60 bg-emerald-500/20 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
          >
            {create.isPending ? "Creating…" : "Create agent"}
          </button>
        </div>
      </div>

      {showGenerator && (
        <GenerateModal
          onClose={() => setShowGenerator(false)}
          onApply={applyDraft}
        />
      )}
    </>
  );
}

function GenerateModal({
  onClose,
  onApply,
}: {
  onClose: () => void;
  onApply: (draft: GeneratedAgentDraft) => void;
}) {
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: () => api.agents.generate(description.trim()),
    onSuccess: ({ draft }) => onApply(draft),
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Generation failed",
      );
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setError(null);
    generate.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-lg rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <Sparkles className="size-4 text-violet-300" />
              Generate an agent with AI
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              Describe what the agent should do. We'll draft a system prompt + config you can review and edit before saving. Nothing is created until you click Create agent.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
          >
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-400">What should the agent do?</span>
            <textarea
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              placeholder="Every morning, summarize yesterday's failed PR builds into a Slack message and mention the author."
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
              autoFocus
            />
          </label>
          {error && (
            <div className="rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
              {error}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={generate.isPending || !description.trim()}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {generate.isPending ? "Drafting…" : "Generate"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              Cancel
            </button>
            {generate.isPending && (
              <span className="text-xs text-zinc-500">
                takes ~15–30s — Claude is writing your prompt
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
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
