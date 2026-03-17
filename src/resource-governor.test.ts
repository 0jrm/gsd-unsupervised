import { describe, it, expect, vi } from 'vitest';
import { currentLoadInfo, waitForHeadroom } from './resource-governor.js';

describe('resource-governor', () => {
  it('returns sane currentLoadInfo shape', () => {
    const info = currentLoadInfo();
    expect(typeof info.load1).toBe('number');
    expect(typeof info.load5).toBe('number');
    expect(typeof info.load15).toBe('number');
    expect(typeof info.cpuCount).toBe('number');
    expect(typeof info.cpuFraction).toBe('number');
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
});

