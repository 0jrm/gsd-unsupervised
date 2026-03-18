import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

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
  /**
   * Best-effort GPU utilization fraction (0–1). Only set when nvidia-smi is
   * available and returns utilization; otherwise undefined.
   */
  gpuFraction?: number;
}

export interface WaitForHeadroomOptions {
  /**
   * Maximum allowed CPU fraction before new agent work is allowed to start.
   * 1.0 means 100% of all logical CPUs; 0.8 recommended for parallel work.
   */
  maxCpuFraction: number;
  /**
   * Maximum allowed memory fraction before new agent work is allowed to start.
   * 1.0 means 100% of total RAM; 0.8 recommended for parallel work.
   */
  maxMemoryFraction?: number;
  /**
   * Maximum allowed GPU utilization fraction (0–1). Only checked when
   * nvidia-smi is available. 0.8 recommended for parallel work.
   */
  maxGpuFraction?: number;
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

/**
 * Best-effort GPU utilization fraction (0–1) via nvidia-smi. Returns undefined
 * if nvidia-smi is not available or parsing fails.
 */
export async function getGpuFraction(): Promise<number | undefined> {
  try {
    const { stdout } = await execFileP('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], {
      timeout: 5000,
      encoding: 'utf-8',
    });
    const line = stdout.trim().split('\n')[0];
    const pct = line ? parseInt(line.trim(), 10) : NaN;
    if (Number.isFinite(pct) && pct >= 0 && pct <= 100) return pct / 100;
  } catch {
    // nvidia-smi not installed or failed
  }
  return undefined;
}

export function currentLoadInfo(
  maxCpuFraction?: number,
  maxMemoryFraction?: number,
  gpuFraction?: number,
): LoadInfo & { maxCpuFraction?: number; maxMemoryFraction?: number; maxGpuFraction?: number } {
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
    gpuFraction,
    maxCpuFraction,
    maxMemoryFraction,
  };
}

/** Like currentLoadInfo but async; fetches GPU utilization when maxGpuFraction is set. */
export async function currentLoadInfoAsync(options: {
  maxCpuFraction?: number;
  maxMemoryFraction?: number;
  maxGpuFraction?: number;
}): Promise<LoadInfo & { maxCpuFraction?: number; maxMemoryFraction?: number; maxGpuFraction?: number }> {
  const gpuFraction = options.maxGpuFraction != null ? await getGpuFraction() : undefined;
  const info = currentLoadInfo(
    options.maxCpuFraction,
    options.maxMemoryFraction,
    gpuFraction,
  );
  return { ...info, maxGpuFraction: options.maxGpuFraction };
}

export async function waitForHeadroom(options: WaitForHeadroomOptions): Promise<void> {
  const {
    maxCpuFraction,
    maxMemoryFraction,
    maxGpuFraction,
    pollIntervalMs = 2000,
    maxWaitMs = 120_000,
    logger,
  } = options;

  // Treat thresholds >= 1 as "no gating" for that resource to keep tests
  // and opt-out configurations fast.
  const validCpu = maxCpuFraction !== undefined && maxCpuFraction > 0 && maxCpuFraction < 1;
  const validMem =
    maxMemoryFraction !== undefined && maxMemoryFraction > 0 && maxMemoryFraction < 1;
  const validGpu =
    maxGpuFraction !== undefined && maxGpuFraction > 0 && maxGpuFraction < 1;

  if (!validCpu && !validMem && !validGpu) {
    logger?.warn(
      { maxCpuFraction, maxMemoryFraction, maxGpuFraction },
      'resource-governor: invalid thresholds, skipping headroom check',
    );
    return;
  }

  const start = Date.now();

  async function getInfo(): Promise<LoadInfo & { maxCpuFraction?: number; maxMemoryFraction?: number; maxGpuFraction?: number }> {
    const gpuFraction = validGpu ? await getGpuFraction() : undefined;
    const info = currentLoadInfo(maxCpuFraction, maxMemoryFraction, gpuFraction);
    return { ...info, maxGpuFraction };
  }

  let info = await getInfo();
  const withinCpu = !validCpu || info.cpuFraction <= (maxCpuFraction as number);
  const withinMem =
    !validMem || info.memoryFraction <= (maxMemoryFraction as number);
  const withinGpu =
    !validGpu ||
    info.gpuFraction == null ||
    info.gpuFraction <= (maxGpuFraction as number);
  if (withinCpu && withinMem && withinGpu) {
    logger?.debug(
      { load: info },
      'resource-governor: sufficient headroom, proceeding immediately',
    );
    return;
  }

  logger?.warn(
    { load: info },
    'resource-governor: high system load detected, waiting for headroom',
  );

  while (
    (!validCpu || info.cpuFraction > (maxCpuFraction as number)) ||
    (!validMem || info.memoryFraction > (maxMemoryFraction as number)) ||
    (validGpu && info.gpuFraction != null && info.gpuFraction > (maxGpuFraction as number))
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
    info = await getInfo();
  }

  logger?.debug(
    { load: info, waitedMs: Date.now() - start },
    'resource-governor: headroom restored, resuming work',
  );
}

