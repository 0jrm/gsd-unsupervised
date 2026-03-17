import os from 'node:os';

export interface LoadInfo {
  load1: number;
  load5: number;
  load15: number;
  cpuCount: number;
  /**
   * Approximate fraction of total CPU capacity used, based on 1-minute load
   * average divided by logical CPU count. This is a heuristic, not a precise
   * utilization metric, but is stable and cheap to compute.
   */
  cpuFraction: number;
  /**
   * Approximate fraction of total system memory in use, based on
   * (total - free) / total from `os.totalmem()` / `os.freemem()`.
   */
  memoryFraction: number;
  totalMemBytes: number;
  freeMemBytes: number;
}

export interface WaitForHeadroomOptions {
  /**
   * Maximum allowed CPU fraction before new agent work is allowed to start.
   * 1.0 means 100% of all logical CPUs; 0.75 (default) means ~75% of total.
   */
  maxCpuFraction: number;
  /**
   * Maximum allowed memory fraction before new agent work is allowed to start.
   * 1.0 means 100% of total RAM; 0.9 (default) means ~90%.
   */
  maxMemoryFraction?: number;
  /**
   * Minimum delay between load checks while waiting for headroom.
   * Defaults to 2s to avoid busy-waiting.
   */
  pollIntervalMs?: number;
  /**
   * Optional absolute upper bound on wait time. When exceeded, the function
   * resolves anyway so the daemon cannot deadlock if the machine is saturated.
   * Defaults to 2 minutes.
   */
  maxWaitMs?: number;
  /**
   * Optional logger interface (subset of pino) used for structured logging.
   */
  logger?: { debug: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };
}

export function currentLoadInfo(
  maxCpuFraction?: number,
  maxMemoryFraction?: number,
): LoadInfo & { maxCpuFraction?: number; maxMemoryFraction?: number } {
  const [load1, load5, load15] = os.loadavg();
  const cpuCount = Math.max(os.cpus()?.length ?? 1, 1);
  const cpuFraction = cpuCount > 0 ? load1 / cpuCount : 0;
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const memoryFraction =
    totalMemBytes > 0 ? (totalMemBytes - freeMemBytes) / totalMemBytes : 0;
  return {
    load1,
    load5,
    load15,
    cpuCount,
    cpuFraction,
    memoryFraction,
    totalMemBytes,
    freeMemBytes,
    maxCpuFraction,
    maxMemoryFraction,
  };
}

export async function waitForHeadroom(options: WaitForHeadroomOptions): Promise<void> {
  const {
    maxCpuFraction,
    maxMemoryFraction,
    pollIntervalMs = 2000,
    maxWaitMs = 120_000,
    logger,
  } = options;

  // Treat thresholds >= 1 as "no gating" for that resource to keep tests
  // and opt-out configurations fast.
  const validCpu = maxCpuFraction !== undefined && maxCpuFraction > 0 && maxCpuFraction < 1;
  const validMem =
    maxMemoryFraction !== undefined && maxMemoryFraction > 0 && maxMemoryFraction < 1;

  if (!validCpu && !validMem) {
    // Misconfiguration — do not block orchestration, just log once and return.
    logger?.warn(
      { maxCpuFraction, maxMemoryFraction },
      'resource-governor: invalid thresholds, skipping headroom check',
    );
    return;
  }

  const start = Date.now();

  // First, allow a cheap fast-path so we don't sleep when there's plenty of headroom.
  let info = currentLoadInfo(maxCpuFraction, maxMemoryFraction);
  const withinCpu = !validCpu || info.cpuFraction <= (maxCpuFraction as number);
  const withinMem =
    !validMem || info.memoryFraction <= (maxMemoryFraction as number);
  if (withinCpu && withinMem) {
    logger?.debug(
      { load: info },
      'resource-governor: sufficient CPU headroom, proceeding immediately',
    );
    return;
  }

  logger?.warn(
    { load: info },
    'resource-governor: high system load detected, waiting for headroom',
  );

  // Slow-path: periodically poll until below threshold or timeout expires.
  while (
    (!validCpu || info.cpuFraction > (maxCpuFraction as number)) ||
    (!validMem || info.memoryFraction > (maxMemoryFraction as number))
  ) {
    const elapsed = Date.now() - start;
    if (elapsed >= maxWaitMs) {
      logger?.warn(
        { load: info, elapsedMs: elapsed, maxWaitMs },
        'resource-governor: max wait exceeded, proceeding despite high load',
      );
      return;
    }

    const remainingMs = maxWaitMs - elapsed;
    const delayMs = Math.min(pollIntervalMs, remainingMs);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    info = currentLoadInfo(maxCpuFraction, maxMemoryFraction);
  }

  logger?.debug(
    { load: info, waitedMs: Date.now() - start },
    'resource-governor: CPU headroom restored, resuming work',
  );
}

