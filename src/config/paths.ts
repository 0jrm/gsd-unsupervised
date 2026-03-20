import type { AutopilotConfig } from '../config.js';
import { isWsl, toWindowsPath } from './wsl.js';

export function getCursorBinaryPath(config: AutopilotConfig): string {
  const override = process.env.GSD_CURSOR_BIN;
  if (override && override.trim() !== '') {
    return override.trim();
  }

  const configured = config.cursorAgentPath ?? 'cursor-agent';

  if (isWsl()) {
    const maybeWindows = toWindowsPath(configured);
    if (maybeWindows) {
      return maybeWindows;
    }
  }

  return configured;
}

export function getCnBinaryPath(config: AutopilotConfig): string {
  const override = process.env.GSD_CN_BIN;
  if (override && override.trim() !== '') {
    return override.trim();
  }
  return config.continueCliPath ?? 'cn';
}

export function getCodexBinaryPath(config: AutopilotConfig): string {
  const override = process.env.GSD_CODEX_BIN;
  if (override && override.trim() !== '') {
    return override.trim();
  }
  return config.codexCliPath ?? 'codex';
}

export function getClipExePath(): string | null {
  if (!isWsl()) return null;

  const fromEnv = process.env.GSD_CLIP_EXE;
  if (fromEnv && fromEnv.trim() !== '') {
    return fromEnv.trim();
  }

  const windowsRoot = toWindowsPath('/mnt/c');
  if (!windowsRoot || !windowsRoot.startsWith('C:\\')) {
    return null;
  }

  return 'C:\\Windows\\System32\\clip.exe';
}

export interface WorkspaceDisplayPath {
  wslPath: string;
  windowsPath: string | null;
}

export function getWorkspaceDisplayPath(workspaceRoot: string): WorkspaceDisplayPath {
  const wslPath = workspaceRoot;

  if (!isWsl()) {
    return { wslPath, windowsPath: null };
  }

  const windowsPath = toWindowsPath(workspaceRoot) ?? null;
  return { wslPath, windowsPath };
}
