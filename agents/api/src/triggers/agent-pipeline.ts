/**
 * Agent → agent pipeline triggers. When upstream agent completes, every agent
 * subscribed to it via an `{type: "agent", source: <upstream>}` trigger gets
 * enqueued — filtered by onSuccess / onFailure if those flags are set.
 *
 * Registered at boot (and on reload) from each agent's config. The worker
 * calls `fireAgentPipeline(name, result)` after it finalizes a run; this
 * module looks up subscribers in the in-memory edge list and dispatches.
 *
 * Cycles are detected at register time and logged loudly — the runtime
 * doesn't try to short-circuit them at fire time (which would be more code
 * for a config error the user should fix in the agent definition).
 */

import {
  logger,
  type AgentTrigger,
  type RunResult,
  type TriggerContext,
} from "@agents/sdk";
import { enqueueRun } from "./dispatch.js";

interface PipelineEdge {
  source: string;
  target: string;
  trigger: AgentTrigger;
}

const edges: PipelineEdge[] = [];

interface AgentPipeline {
  name: string;
  triggers: AgentTrigger[];
}

export function registerAgentPipelineTriggers(agents: AgentPipeline[]): number {
  let registered = 0;
  for (const agent of agents) {
    for (const trigger of agent.triggers) {
      edges.push({ source: trigger.source, target: agent.name, trigger });
      logger.info("Pipeline edge registered", {
        source: trigger.source,
        target: agent.name,
        onSuccess: trigger.onSuccess,
        onFailure: trigger.onFailure,
        passResult: trigger.passResult,
      });
      registered++;
    }
  }

  // Cycle detection — strongly-connected component via DFS. Logs only; the
  // edges stay in place because the runtime doesn't need them to be acyclic
  // (a cycle just keeps firing if the conditions stay met, which is the
  // user's bug to fix in their agent config).
  detectCycles().forEach((cycle) => {
    logger.error("Pipeline cycle detected", { cycle });
  });

  return registered;
}

export function clearAgentPipelineEdges(): void {
  edges.length = 0;
}

/**
 * Called by the worker after a run finalizes. Looks up every subscriber to
 * `sourceAgentName`, filters by onSuccess / onFailure, enqueues a run for
 * each matching subscriber.
 *
 * Builds the trigger context with `upstreamResult` populated when the
 * subscriber asked for it (passResult: true).
 */
export async function fireAgentPipeline(
  sourceAgentName: string,
  result: RunResult,
): Promise<void> {
  const matching = edges.filter((e) => e.source === sourceAgentName);
  if (matching.length === 0) return;

  const isSuccess = result.status === "success";
  for (const edge of matching) {
    // Default: fire on any outcome. onSuccess/onFailure are filters; when
    // both are unset, every completion fires.
    if (edge.trigger.onSuccess && !isSuccess) continue;
    if (edge.trigger.onFailure && isSuccess) continue;

    const ctx: TriggerContext = {
      triggerType: "agent",
      triggeredAt: new Date().toISOString(),
      ...(edge.trigger.passResult ? { upstreamResult: result } : {}),
      meta: {
        source: sourceAgentName,
        upstreamStatus: result.status,
        upstreamDurationMs: result.durationMs,
      },
    };
    logger.info("Pipeline trigger firing", {
      source: sourceAgentName,
      target: edge.target,
      upstreamStatus: result.status,
    });
    await enqueueRun(edge.target, ctx);
  }
}

function detectCycles(): string[][] {
  const graph = new Map<string, string[]>();
  for (const e of edges) {
    const arr = graph.get(e.source) ?? [];
    arr.push(e.target);
    graph.set(e.source, arr);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  const dfs = (node: string): void => {
    if (stack.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push([...path.slice(cycleStart), node]);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    path.push(node);
    for (const next of graph.get(node) ?? []) {
      dfs(next);
    }
    stack.delete(node);
    path.pop();
  };

  for (const node of graph.keys()) dfs(node);
  return cycles;
}

/**
 * Read-only accessor for the UI — returns the current edges so the agent
 * detail page can render an "incoming" / "outgoing" panel without making
 * the UI parse every agent's configJson.
 */
export function listPipelineEdges(): ReadonlyArray<PipelineEdge> {
  return edges;
}
