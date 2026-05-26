/**
 * console sender — writes a single structured log line to the API process
 * stdout. The simplest possible transport; always works. Useful as the
 * default channel so users have *something* connected before configuring
 * a real destination.
 */

import { registerSender, type SenderFn } from "@agents/core";

const consoleSender: SenderFn = async (channel, args) => {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      notification: true,
      channel: channel.displayName,
      event: args.event,
      title: args.title,
      body: args.body,
      subject: args.subjectRef,
    }),
  );
  return { delivered: "console" };
};

export function registerConsoleSender(): void {
  registerSender("console", consoleSender);
}
