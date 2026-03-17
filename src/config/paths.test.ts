import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AutopilotConfig } from './config.js';
import * as wslHelpers from './wsl.js';
import { getClipExePath, getCursorBinaryPath, getWorkspaceDisplayPath } from './paths.js';

const baseConfig: AutopilotConfig = {
  goalsPath: './goals.md',
  parallel: false,
  maxConcurrent: 3,
  maxCpuFraction: 0.75,
  maxMemoryFraction: 0.9,
  verbose: false,
  logLevel: 'info',
  workspaceRoot: '/mnt/c/Users/test/proj',
  agent: 'cursor',
  cursorAgentPath: 'cursor-agent',
  agentTimeoutMs: 600_000,
  sessionLogPath: './session-log.jsonl',
  stateWatchDebounceMs: 500,
  requireCleanGitBeforePlan: true,
  autoCheckpoint: false,
};

describe('paths helpers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetAllMocks();
  });

  it('getCursorBinaryPath prefers GSD_CURSOR_BIN env', () => {
    process.env.GSD_CURSOR_BIN = '/custom/cursor';
    vi.spyOn(wslHelpers, 'isWsl').mockReturnValue(false);

    const result = getCursorBinaryPath(baseConfig);
    expect(result).toBe('/custom/cursor');
  });

  it('getCursorBinaryPath uses config path when no env override', () => {
    vi.spyOn(wslHelpers, 'isWsl').mockReturnValue(false);

    const result = getCursorBinaryPath({
      ...baseConfig,
      cursorAgentPath: '/usr/local/bin/cursor-agent',
    });
    expect(result).toBe('/usr/local/bin/cursor-agent');
  });

  it('getClipExePath returns null when not in WSL', () => {
    vi.spyOn(wslHelpers, 'isWsl').mockReturnValue(false);
    expect(getClipExePath()).toBeNull();
  });

  it('getClipExePath returns env override when in WSL', () => {
    vi.spyOn(wslHelpers, 'isWsl').mockReturnValue(true);
    process.env.GSD_CLIP_EXE = 'D:\\Tools\\clip.exe';
    expect(getClipExePath()).toBe('D:\\Tools\\clip.exe');
  });

  it('getWorkspaceDisplayPath maps /mnt/c path when in WSL', () => {
    vi.spyOn(wslHelpers, 'isWsl').mockReturnValue(true);
    vi.spyOn(wslHelpers, 'toWindowsPath').mockImplementation((p: string) => {
      if (p.startsWith('/mnt/c/')) {
        return 'C:\\Users\\test\\proj';
      }
      return null;
    });

    const result = getWorkspaceDisplayPath('/mnt/c/Users/test/proj');
    expect(result.wslPath).toBe('/mnt/c/Users/test/proj');
    expect(result.windowsPath).toBe('C:\\Users\\test\\proj');
  });
});

