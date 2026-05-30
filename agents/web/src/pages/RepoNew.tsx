import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  Folder,
  FolderGit2,
  X,
} from "lucide-react";
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
  const [showPicker, setShowPicker] = useState(false);

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
              <div className="flex gap-2">
                <input
                  type="text"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder="/Users/you/code/my-project"
                  className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
                  title="Browse directories on the API server"
                >
                  <Folder className="size-4" /> Browse…
                </button>
              </div>
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

      {showPicker && (
        <DirPicker
          onClose={() => setShowPicker(false)}
          onSelect={(p) => {
            setLocalPath(p);
            setShowPicker(false);
          }}
        />
      )}
    </>
  );
}

function DirPicker({
  onSelect,
  onClose,
}: {
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined);
  const { data, isLoading, error } = useQuery({
    queryKey: ["repos", "browse", currentPath ?? "__home__"],
    queryFn: () => api.repos.browse(currentPath),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="text-sm font-medium text-zinc-100">
            Pick a local git checkout
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
          <button
            type="button"
            disabled={!data || data.path === "/"}
            onClick={() => data && setCurrentPath(data.parent)}
            className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
            title="Go to parent directory"
          >
            <ArrowUp className="size-3.5" /> Up
          </button>
          <div
            className="flex-1 truncate font-mono text-xs text-zinc-300"
            title={data?.path}
          >
            {data?.path ?? (isLoading ? "loading…" : "")}
          </div>
          {data?.isGitRepo && (
            <button
              type="button"
              onClick={() => onSelect(data.path)}
              className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500"
            >
              <Check className="size-3.5" /> Select this folder
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="p-4 text-xs text-rose-400">
              {error instanceof ApiError ? error.message : String(error)}
            </div>
          )}
          {!error && data && data.entries.length === 0 && (
            <div className="p-4 text-xs text-zinc-500">
              empty directory (dotfiles hidden)
            </div>
          )}
          {!error &&
            data?.entries.map((entry) => {
              const childPath =
                data.path === "/" ? `/${entry.name}` : `${data.path}/${entry.name}`;
              return (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => setCurrentPath(childPath)}
                  className="flex w-full items-center gap-2 border-b border-zinc-900 px-4 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900"
                >
                  {entry.isGitRepo ? (
                    <FolderGit2 className="size-4 shrink-0 text-emerald-400" />
                  ) : (
                    <Folder className="size-4 shrink-0 text-zinc-500" />
                  )}
                  <span className="flex-1 truncate font-mono">{entry.name}</span>
                  {entry.isGitRepo && (
                    <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                      git
                    </span>
                  )}
                </button>
              );
            })}
        </div>

        <div className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
          Click a folder to open it. Folders marked{" "}
          <span className="text-emerald-400">git</span> are git checkouts —
          open one, then click <strong>Select this folder</strong>.
        </div>
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
