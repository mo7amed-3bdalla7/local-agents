import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api, ApiError, type CreateRepoArgs } from "../api.ts";
import { PageHeader } from "../components/PageHeader.tsx";

const NAME_PATTERN = /^[^/\s]+\/[^/\s]+$/;

export function RepoNew() {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const [githubFullName, setGithubFullName] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [testCommand, setTestCommand] = useState("");

  const create = useMutation({
    mutationFn: (args: CreateRepoArgs) => api.repos.create(args),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["repos"] });
      nav("/repos");
    },
  });

  const nameValid = NAME_PATTERN.test(githubFullName);
  const ready = nameValid && !create.isPending;

  const submit = () => {
    if (!ready) return;
    create.mutate({
      githubFullName: githubFullName.trim(),
      defaultBranch: defaultBranch.trim() || undefined,
      testCommand: testCommand.trim() || undefined,
    });
  };

  return (
    <>
      <Link
        to="/repos"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" /> Repos
      </Link>
      <PageHeader
        title="Register repo"
        description="Clones the repo into ~/.agents/worktrees/<owner>__<name>/.repo. May take a moment for a fresh checkout."
      />

      {create.error && (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {create.error instanceof ApiError
            ? create.error.message
            : String(create.error)}
        </div>
      )}

      <div className="max-w-2xl space-y-6">
        <Field label="GitHub repo" hint="owner/name">
          <input
            type="text"
            value={githubFullName}
            onChange={(e) => setGithubFullName(e.target.value)}
            placeholder="anthropic/example"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500"
          />
          {githubFullName && !nameValid && (
            <div className="mt-1 text-xs text-amber-400">
              must be in `owner/name` form
            </div>
          )}
        </Field>

        <Field label="Default branch" hint="optional; defaults to main">
          <input
            type="text"
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            placeholder="main"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500"
          />
        </Field>

        <Field
          label="Test command"
          hint="optional; agents call this when they want to run tests"
        >
          <input
            type="text"
            value={testCommand}
            onChange={(e) => setTestCommand(e.target.value)}
            placeholder="pnpm test"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500"
          />
        </Field>

        <button
          type="button"
          onClick={submit}
          disabled={!ready}
          className="w-full rounded-md border border-emerald-500/60 bg-emerald-500/20 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
        >
          {create.isPending ? "Cloning…" : "Register + clone"}
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
