import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api, ApiError, type CreateRepoArgs } from "../api.ts";
import { PageHeader } from "../components/PageHeader.tsx";

const NAME_PATTERN = /^[^/\s]+\/[^/\s]+$/;

type Mode = "clone" | "link";

export function RepoNew() {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("clone");

  // Clone-mode state
  const [githubFullName, setGithubFullName] = useState("");

  // Link-mode state
  const [localPath, setLocalPath] = useState("");
  const [originOverride, setOriginOverride] = useState("");

  // Shared
  const [defaultBranch, setDefaultBranch] = useState("");
  const [testCommand, setTestCommand] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (args: CreateRepoArgs) => api.repos.create(args),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["repos"] });
      nav("/repos");
    },
  });

  const cloneNameValid = NAME_PATTERN.test(githubFullName);
  const linkPathValid = localPath.startsWith("/");

  const submit = () => {
    setSubmitError(null);
    if (mode === "clone") {
      if (!cloneNameValid) {
        setSubmitError('GitHub repo must be in "owner/name" form.');
        return;
      }
      create.mutate({
        githubFullName: githubFullName.trim(),
        defaultBranch: defaultBranch.trim() || undefined,
        testCommand: testCommand.trim() || undefined,
      });
    } else {
      if (!linkPathValid) {
        setSubmitError("Local path must be an absolute path (start with /).");
        return;
      }
      create.mutate({
        localPath: localPath.trim(),
        githubFullName: originOverride.trim() || undefined,
        defaultBranch: defaultBranch.trim() || undefined,
        testCommand: testCommand.trim() || undefined,
      });
    }
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
        description={
          mode === "clone"
            ? "Clones the repo into ~/.agents/worktrees/<owner>__<name>/.repo. May take a moment for a fresh checkout."
            : "Links an existing local clone — no re-clone. The GitHub URL is auto-detected from the repo's `origin` remote."
        }
      />

      <div className="mb-6 max-w-2xl">
        <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950/40 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("clone")}
            className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
              mode === "clone"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            Clone from GitHub
          </button>
          <button
            type="button"
            onClick={() => setMode("link")}
            className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
              mode === "link"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            Link local clone
          </button>
        </div>
      </div>

      {create.error && (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {create.error instanceof ApiError
            ? create.error.message
            : String(create.error)}
        </div>
      )}

      <div className="max-w-2xl space-y-6">
        {mode === "clone" ? (
          <Field label="GitHub repo" hint="owner/name">
            <input
              type="text"
              value={githubFullName}
              onChange={(e) => setGithubFullName(e.target.value)}
              placeholder="anthropic/example"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
            {githubFullName && !cloneNameValid && (
              <div className="mt-1 text-xs text-amber-400">
                must be in `owner/name` form
              </div>
            )}
          </Field>
        ) : (
          <>
            <Field
              label="Local path"
              hint="absolute path to an existing git checkout on your machine"
            >
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="/Users/you/code/my-project"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
              {localPath && !linkPathValid && (
                <div className="mt-1 text-xs text-amber-400">
                  must be an absolute path (start with `/`)
                </div>
              )}
              <div className="mt-2 space-y-1 text-[11px] text-zinc-500">
                <div>
                  The path must exist and contain a{" "}
                  <code className="text-zinc-400">.git/</code> directory, and
                  be readable by the API process. The platform never copies
                  or re-clones — the row points at this exact path.
                </div>
                <div>
                  <span className="font-semibold text-zinc-400">
                    Dev mode (pnpm api):
                  </span>{" "}
                  any absolute path on your machine works.
                </div>
                <div>
                  <span className="font-semibold text-zinc-400">
                    Docker mode:
                  </span>{" "}
                  the path is{" "}
                  <em>inside the container</em>. To use host repos from a
                  custom path, bind-mount your code dir in{" "}
                  <code className="text-zinc-400">docker-compose.yml</code>{" "}
                  (the api service has a commented-out example), then paste
                  the container-side path here — e.g.{" "}
                  <code className="text-zinc-400">/host-repos/my-project</code>.
                </div>
              </div>
            </Field>
            <Field
              label="GitHub repo (override)"
              hint="optional; auto-detected from origin URL if left blank"
            >
              <input
                type="text"
                value={originOverride}
                onChange={(e) => setOriginOverride(e.target.value)}
                placeholder="(auto-detect from `git config remote.origin.url`)"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </Field>
          </>
        )}

        <Field
          label="Default branch"
          hint={
            mode === "clone"
              ? "optional; defaults to main"
              : "optional; auto-detected from origin/HEAD if left blank"
          }
        >
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

        {submitError && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {submitError}
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={create.isPending}
          className="w-full rounded-md border border-emerald-500/60 bg-emerald-500/20 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
        >
          {create.isPending
            ? mode === "clone"
              ? "Cloning…"
              : "Linking…"
            : mode === "clone"
              ? "Register + clone"
              : "Link local repo"}
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
