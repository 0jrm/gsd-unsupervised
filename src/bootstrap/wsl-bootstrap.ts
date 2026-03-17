import type { AutopilotConfig } from '../config.js';
import { isWsl } from '../config/wsl.js';
import {
  getClipExePath,
  getCursorBinaryPath,
  getWorkspaceDisplayPath,
} from '../config/paths.js';

export interface ResolvedEnvironment {
  isWsl: boolean;
  cursorBinaryPath: string;
  clipExePath: string | null;
  workspace: {
    wslPath: string;
    windowsPath: string | null;
  };
}

export function applyWslBootstrap(config: AutopilotConfig): ResolvedEnvironment {
  const isWslEnv = isWsl();
  const cursorBinaryPath = getCursorBinaryPath(config);
  const clipExePath = getClipExePath();
  const workspace = getWorkspaceDisplayPath(config.workspaceRoot);

  return {
    isWsl: isWslEnv,
    cursorBinaryPath,
    clipExePath,
    workspace,
  };
}

