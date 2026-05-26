/**
 * File-watch triggers. Uses chokidar to watch the workspace root as a single
 * directory. We do our own glob match per event because chokidar v5 dropped
 * built-in glob support (patterns must be paths or directories).
 *
 * macOS-specific note: chokidar v5 also dropped its fsevents adapter, so on
 * a workspace with node_modules, .git, etc. the default fs.watch recursive
 * mode hits EMFILE (the per-process FD soft-limit). We force polling, which
 * uses one stat-loop per file we care about and zero FDs per directory.
 */

import chokidar, { type FSWatcher } from "chokidar";
import { logger, type FileTrigger, type TriggerContext } from "@agents/sdk";
import { workspaceRoot } from "../paths.js";
import { enqueueRun } from "./dispatch.js";

const watchers: FSWatcher[] = [];

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/.turbo/**",
  "**/.vite-temp/**",
  "**/logs/**",
];

/** Tiny glob → regex. Supports `*` (segment) and `**` (any-depth). */
function globToRegExp(pattern: string): RegExp {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${re}$`);
}

function matchesAny(filePath: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(filePath));
}

interface AgentFile {
  name: string;
  triggers: FileTrigger[];
}

export function registerFileTriggers(agents: AgentFile[]): number {
  const root = workspaceRoot();
  let registered = 0;

  for (const agent of agents) {
    for (const trigger of agent.triggers) {
      const debounceMs = trigger.debounceMs ?? 500;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let changed = new Set<string>();

      const includeRegexes = trigger.patterns.map(globToRegExp);
      const ignoreRegexes = [
        ...DEFAULT_IGNORE,
        ...(trigger.ignore ?? []),
      ].map(globToRegExp);

      const watcher = chokidar.watch(root, {
        ignored: [...DEFAULT_IGNORE, ...(trigger.ignore ?? [])],
        ignoreInitial: true,
        persistent: true,
        usePolling: true,
        interval: 1000,
        binaryInterval: 2000,
      });

      const handle = (rel: string) => {
        if (matchesAny(rel, ignoreRegexes)) return;
        if (!matchesAny(rel, includeRegexes)) return;
        changed.add(rel);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const files = Array.from(changed);
          changed = new Set();
          const ctx: TriggerContext = {
            triggerType: "file",
            triggeredAt: new Date().toISOString(),
            changedFiles: files,
            meta: { patterns: trigger.patterns },
          };
          void enqueueRun(agent.name, ctx);
        }, debounceMs);
      };

      // chokidar paths are absolute when watching a directory; relativize to
      // the workspace root so authors' patterns can be repo-relative.
      const toRel = (abs: string) =>
        abs.startsWith(root + "/") ? abs.slice(root.length + 1) : abs;

      watcher.on("add", (p) => handle(toRel(p)));
      watcher.on("change", (p) => handle(toRel(p)));
      watcher.on("unlink", (p) => handle(toRel(p)));
      watcher.on("error", (err) =>
        logger.error("File watcher error", {
          agent: agent.name,
          error: err instanceof Error ? err.message : String(err),
        }),
      );

      watchers.push(watcher);
      logger.info("File trigger registered", {
        agent: agent.name,
        patterns: trigger.patterns,
        debounceMs,
      });
      registered++;
    }
  }
  return registered;
}

export async function stopAllFileWatchers(): Promise<void> {
  await Promise.all(watchers.map((w) => w.close()));
  watchers.length = 0;
}
