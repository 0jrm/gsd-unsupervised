import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import { currentLoadInfo, waitForHeadroom } from './resource-governor.js';

describe('resource-governor', () => {
  it('returns sane currentLoadInfo shape', () => {
    const info = currentLoadInfo();
    expect(typeof info.load1).toBe('number');
    expect(typeof info.load5).toBe('number');
    expect(typeof info.load15).toBe('number');
    expect(typeof info.cpuCount).toBe('number');
    expect(typeof info.cpuFraction).toBe('number');
    expect(typeof info.memoryFraction).toBe('number');
    expect(typeof info.totalMemBytes).toBe('number');
    expect(typeof info.freeMemBytes).toBe('number');
    expect(info.cpuCount).toBeGreaterThan(0);
  });

  it('waitForHeadroom resolves quickly when load is already below threshold', async () => {
    const logger = { debug: vi.fn(), warn: vi.fn() };
    await expect(
      waitForHeadroom({
        maxCpuFraction: 0.99,
        pollIntervalMs: 10,
        maxWaitMs: 1000,
        logger,
      }),
    ).resolves.toBeUndefined();
  });

  it('waitForHeadroom does not throw on invalid config', async () => {
    const logger = { debug: vi.fn(), warn: vi.fn() };
    await expect(
      waitForHeadroom({
        // Invalid (> 1) but should not crash orchestration.
        maxCpuFraction: 1.5,
        pollIntervalMs: 10,
        maxWaitMs: 50,
        logger,
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('waitForHeadroom delays when memory fraction exceeds maxMemoryFraction', async () => {
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const totalMem = 1_000_000_000;
    const freeMem = 100_000_000; // 90% used
    vi.spyOn(os, 'totalmem').mockReturnValue(totalMem);
    vi.spyOn(os, 'freemem').mockReturnValue(freeMem);
    vi.spyOn(os, 'loadavg').mockReturnValue([0, 0, 0]); // CPU idle so only memory gates

    const start = Date.now();
    const p = waitForHeadroom({
      maxCpuFraction: 0.99,
      maxMemoryFraction: 0.8,
      pollIntervalMs: 50,
      maxWaitMs: 200,
      logger,
    });
    await p;
    const elapsed = Date.now() - start;

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        load: expect.objectContaining({
          memoryFraction: 0.9,
          maxMemoryFraction: 0.8,
          freeMemBytes: freeMem,
          totalMemBytes: totalMem,
        }),
      }),
      'resource-governor: high system load detected, waiting for headroom',
    );
    expect(elapsed).toBeGreaterThanOrEqual(50);
    vi.restoreAllMocks();
  });

  it('waitForHeadroom logs memory pressure and resolves when memory mock is relaxed', async () => {
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const totalMem = 8 * 1024 * 1024 * 1024; // 8 GB
    const freeMemHighPressure = 0.5 * 1024 * 1024 * 1024; // 0.5 GB => ~93.75% used
    const freeMemRelaxed = 2 * 1024 * 1024 * 1024; // 2 GB => 75% used
    vi.spyOn(os, 'totalmem').mockReturnValue(totalMem);
    vi.spyOn(os, 'freemem')
      .mockReturnValueOnce(freeMemHighPressure)
      .mockReturnValueOnce(freeMemHighPressure)
      .mockReturnValue(freeMemRelaxed);
    vi.spyOn(os, 'loadavg').mockReturnValue([0, 0, 0]);

    await waitForHeadroom({
      maxCpuFraction: 0.99,
      maxMemoryFraction: 0.9,
      pollIntervalMs: 10,
      maxWaitMs: 500,
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ memFraction: expect.any(Number), maxMemoryFraction: 0.9 }),
      'memory pressure, waiting for headroom',
    );
    vi.restoreAllMocks();
  });
});

