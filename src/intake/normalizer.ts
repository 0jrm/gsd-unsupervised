import type { RawGoal, IntakeSource } from './types.js';

export function makeReceivedAtIso(): string {
  return new Date().toISOString();
}

export function normalizeCliInput(title: string, replyTo: string | undefined, projectPath: string): RawGoal {
  const source: IntakeSource = 'cli';
  return {
    title,
    replyTo,
    source,
    projectPath,
    receivedAt: makeReceivedAtIso(),
  };
}

export function normalizeDashboardInput(
  input: { title: string; body?: string },
  projectPath: string,
): RawGoal {
  const source: IntakeSource = 'dashboard';
  return {
    title: input.title,
    body: input.body,
    source,
    projectPath,
    receivedAt: makeReceivedAtIso(),
  };
}

export function normalizeSmsInput(title: string, from: string, projectPath: string): RawGoal {
  const source: IntakeSource = 'sms';
  return {
    title,
    source,
    projectPath,
    replyTo: from,
    receivedAt: makeReceivedAtIso(),
  };
}

