/**
 * Cron triggers. Walks every registered agent's configJson.triggers list, finds
 * the `type: "cron"` entries, schedules them with node-cron, and on fire
 * enqueues a run via the shared dispatcher.
 */

import cron from "node-cron";
import { logger, type CronTrigger, type TriggerContext } from "@agents/sdk";
import { enqueueRun } from "./dispatch.js";

const tasks: cron.ScheduledTask[] = [];

interface AgentCron {
  name: string;
  triggers: CronTrigger[];
}

export function registerCronTriggers(agents: AgentCron[]): number {
  let registered = 0;
  for (const agent of agents) {
    for (const trigger of agent.triggers) {
      if (!cron.validate(trigger.schedule)) {
        logger.error("Invalid cron schedule", {
          agent: agent.name,
          schedule: trigger.schedule,
        });
        continue;
      }
      const task = cron.schedule(
        trigger.schedule,
        () => {
          const ctx: TriggerContext = {
            triggerType: "cron",
            triggeredAt: new Date().toISOString(),
            meta: { schedule: trigger.schedule },
          };
          void enqueueRun(agent.name, ctx);
        },
        { timezone: trigger.timezone, scheduled: true },
      );
      tasks.push(task);
      logger.info("Cron trigger registered", {
        agent: agent.name,
        schedule: trigger.schedule,
        timezone: trigger.timezone ?? "(local)",
      });
      registered++;
    }
  }
  return registered;
}

export function stopAllCronTasks(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}
