#!/usr/bin/env node
/**
 * `agents` CLI — talks to the local-agents-me API over HTTP using a Bearer
 * token. Hand-rolled dispatcher (no commander/yargs) — the command surface
 * is small enough that the deps aren't worth it.
 *
 * Auth model: `agents login --token agt_...` saves config to
 *   ~/.config/agents/config.json (0600). Every subsequent command reads it.
 */

import pc from "picocolors";
import {
  ApiError,
  cmdAgentsAbort,
  cmdAgentsList,
  cmdAgentsRun,
  cmdLogin,
  cmdLogout,
  cmdRunsList,
  cmdRunsTail,
  cmdSessionsList,
  cmdTokensList,
  cmdTokensMint,
  cmdTokensRevoke,
  cmdWhoami,
} from "./commands.js";

function usage(): void {
  console.log(`
${pc.bold("agents")} — control plane for local-agents-me

${pc.bold("AUTH")}
  agents login --token agt_... [--api URL]   Save token to ~/.config/agents/config.json
  agents logout                              Clear stored token
  agents whoami                              Show authenticated user

${pc.bold("AGENTS")}
  agents agents list                         List discovered/created agents
  agents agents run <name>                   Trigger a run by agent name
  agents agents abort <runId>                Abort an in-flight run

${pc.bold("RUNS")}
  agents runs list [--agent N] [--status S] [--limit N]
  agents runs tail <runId>                   Stream session events until done

${pc.bold("SESSIONS")}
  agents sessions list [--agent N] [--status S] [--limit N]

${pc.bold("TOKENS")}
  agents tokens list
  agents tokens mint <name>                  Returns plaintext once
  agents tokens revoke <id>

${pc.bold("ENV")}
  AGENTS_API       Base URL (default http://localhost:3848)
  AGENTS_TOKEN     Bearer token (overrides config)
  AGENTS_CONFIG    Override config file path
`);
}

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgv(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags.set(name, next);
        i++;
      } else {
        flags.set(name, true);
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function getFlag(flags: Map<string, string | true>, name: string): string | undefined {
  const v = flags.get(name);
  return typeof v === "string" ? v : undefined;
}
function getNumFlag(
  flags: Map<string, string | true>,
  name: string,
): number | undefined {
  const v = getFlag(flags, name);
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    usage();
    return 0;
  }

  const { positional, flags } = parseArgv(argv);
  const [group, sub, ...rest] = positional;

  switch (group) {
    case "login":
      await cmdLogin({
        api: getFlag(flags, "api"),
        token: getFlag(flags, "token"),
      });
      return 0;
    case "logout":
      await cmdLogout();
      return 0;
    case "whoami":
      await cmdWhoami();
      return 0;

    case "agents": {
      switch (sub) {
        case "list":
          await cmdAgentsList();
          return 0;
        case "run":
          if (!rest[0]) throw new Error("Usage: agents agents run <name>");
          await cmdAgentsRun(rest[0]);
          return 0;
        case "abort":
          if (!rest[0]) throw new Error("Usage: agents agents abort <runId>");
          await cmdAgentsAbort(rest[0]);
          return 0;
        default:
          throw new Error(`Unknown agents subcommand: ${sub ?? "(none)"}`);
      }
    }

    case "runs": {
      switch (sub) {
        case "list":
          await cmdRunsList({
            agent: getFlag(flags, "agent"),
            status: getFlag(flags, "status"),
            limit: getNumFlag(flags, "limit"),
          });
          return 0;
        case "tail":
          if (!rest[0]) throw new Error("Usage: agents runs tail <runId>");
          await cmdRunsTail(rest[0]);
          return 0;
        default:
          throw new Error(`Unknown runs subcommand: ${sub ?? "(none)"}`);
      }
    }

    case "sessions": {
      switch (sub) {
        case "list":
          await cmdSessionsList({
            agent: getFlag(flags, "agent"),
            status: getFlag(flags, "status"),
            limit: getNumFlag(flags, "limit"),
          });
          return 0;
        default:
          throw new Error(`Unknown sessions subcommand: ${sub ?? "(none)"}`);
      }
    }

    case "tokens": {
      switch (sub) {
        case "list":
          await cmdTokensList();
          return 0;
        case "mint":
          if (!rest[0]) throw new Error("Usage: agents tokens mint <name>");
          await cmdTokensMint(rest[0]);
          return 0;
        case "revoke":
          if (!rest[0]) throw new Error("Usage: agents tokens revoke <id>");
          await cmdTokensRevoke(rest[0]);
          return 0;
        default:
          throw new Error(`Unknown tokens subcommand: ${sub ?? "(none)"}`);
      }
    }

    default:
      usage();
      console.error(pc.red(`Unknown command: ${group}`));
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof ApiError) {
      console.error(pc.red("API error:"), err.message);
    } else if (err instanceof Error) {
      console.error(pc.red("Error:"), err.message);
    } else {
      console.error(pc.red("Error:"), String(err));
    }
    process.exit(1);
  });
