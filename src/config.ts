import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';

export const AutopilotConfigSchema = z.object({
  goalsPath: z.string().default('./goals.md'),
  parallel: z.boolean().default(false),
  maxConcurrent: z.number().int().min(1).max(10).default(3),
  verbose: z.boolean().default(false),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  workspaceRoot: z.string().default(process.cwd()),
  cursorAgentPath: z.string().default('cursor-agent'),
  agentTimeoutMs: z.number().int().min(10000).default(600000),
  sessionLogPath: z.string().default('./session-log.jsonl'),
});

export type AutopilotConfig = z.infer<typeof AutopilotConfigSchema>;

export function loadConfig(options: {
  configPath?: string;
  cliOverrides?: Partial<AutopilotConfig>;
}): AutopilotConfig {
  const { configPath, cliOverrides } = options;

  let fileValues: Record<string, unknown> = {};
  if (configPath && existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    fileValues = JSON.parse(raw);
  }

  const merged = { ...fileValues, ...stripUndefined(cliOverrides ?? {}) };

  const result = AutopilotConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Config validation failed:\n${issues}`);
  }

  return result.data;
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  );
}
