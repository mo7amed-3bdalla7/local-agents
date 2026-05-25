/**
 * In-process cache of loaded file-based agents.
 *
 * Populated by syncFileAgents() at boot (and on rescans). The worker reads
 * from here to look up the AgentConfig + on-disk directory it needs to
 * dispatch into executeAgent(). DB-source agents (later) will plug in here
 * the same way once they can be materialized to disk.
 */

import type { AgentConfig } from "@agents/sdk";

export interface AgentEntry {
  config: AgentConfig;
  dir: string;
}

const byName = new Map<string, AgentEntry>();

export function registerAgent(entry: AgentEntry): void {
  byName.set(entry.config.name, entry);
}

export function getAgent(name: string): AgentEntry | undefined {
  return byName.get(name);
}

export function clearRegistry(): void {
  byName.clear();
}

export function registeredNames(): string[] {
  return Array.from(byName.keys());
}
