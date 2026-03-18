import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { SUPPORTED_AGENTS } from './agent-runner.js';

export const AgentIdSchema = z.enum(SUPPORTED_AGENTS as unknown as [string, ...string[]]);

export const AutopilotConfigSchema = z.object({
  goalsPath: z.string().default('./goals.md'),
  parallel: z.boolean().default(false),
  maxConcurrent: z.number().int().min(1).max(10).default(3),
  /**
   * Upper bound on allowed CPU usage before new agent work waits.
   * Expressed as a fraction of total CPU capacity (1.0 = 100%). 0.8 = 80% recommended for parallel.
   */
  maxCpuFraction: z.number().min(0.1).max(1).default(0.8),
  /**
   * Upper bound on allowed memory usage before new agent work waits.
   * Expressed as a fraction of total system memory (1.0 = 100%). 0.8 = 80% recommended for parallel.
   */
  maxMemoryFraction: z.number().min(0.5).max(1).default(0.8),
  /**
   * Upper bound on GPU utilization (0–1) when nvidia-smi is available. 0.8 = 80% recommended for parallel.
   */
  maxGpuFraction: z.number().min(0.1).max(1).optional(),
  verbose: z.boolean().default(false),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  workspaceRoot: z.string().default(process.cwd()),
  /** Agent type: cursor (default), claude-code, gemini-cli, codex. Invalid values fail validation. */
  agent: AgentIdSchema.default('cursor'),
  cursorAgentPath: z.string().default('cursor-agent'),
  agentTimeoutMs: z.number().int().min(10000).default(600000),
  sessionLogPath: z.string().default('./session-log.jsonl'),
  stateWatchDebounceMs: z.number().int().min(100).default(500),
  /** When true, refuse execute-plan when git working tree is dirty (default true). */
  requireCleanGitBeforePlan: z.boolean().default(true),
  /** When true and tree is dirty, create a checkpoint commit before execute-plan (default false). */
  autoCheckpoint: z.boolean().default(false),
  /** When set, start HTTP status server on this port (GET / or /status returns JSON). */
  statusServerPort: z.number().int().min(1).max(65535).optional(),
  /** When true and statusServerPort is set, spawn `ngrok http <port>` for the duration of the daemon. */
  ngrok: z.boolean().default(false),
  /** When set, daemon writes PID, progress, lastHeartbeat to this state file (.gsd/state.json). */
  statePath: z.string().optional(),
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

  const workspaceRoot =
    (cliOverrides?.workspaceRoot as string | undefined) ??
    (fileValues.workspaceRoot as string | undefined) ??
    process.cwd();

  // `.planning/config.json` is primarily for GSD framework behavior, but we also
  // allow it to override a small set of daemon runtime flags (e.g. autoCheckpoint).
  const planningOverrides = readPlanningOverrides(workspaceRoot);

  const merged = {
    ...fileValues,
    ...planningOverrides,
    ...stripUndefined(cliOverrides ?? {}),
  };

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

function readPlanningOverrides(workspaceRoot: string): Partial<AutopilotConfig> {
  try {
    const planningPath = path.join(workspaceRoot, '.planning', 'config.json');
    if (!existsSync(planningPath)) return {};
    const raw = readFileSync(planningPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const overrides: Partial<AutopilotConfig> = {};
    if (typeof parsed.autoCheckpoint === 'boolean') {
      overrides.autoCheckpoint = parsed.autoCheckpoint;
    }
    if (typeof parsed.maxConcurrent === 'number') {
      overrides.maxConcurrent = parsed.maxConcurrent;
    }
    if (typeof parsed.maxCpuFraction === 'number') {
      overrides.maxCpuFraction = parsed.maxCpuFraction;
    }
    if (typeof parsed.maxMemoryFraction === 'number') {
      overrides.maxMemoryFraction = parsed.maxMemoryFraction;
    }
    if (typeof parsed.maxGpuFraction === 'number') {
      overrides.maxGpuFraction = parsed.maxGpuFraction;
    }
    return overrides;
  } catch {
    return {};
  }
}
