import { readFileSync } from 'node:fs';

const WSL_ENV_VARS = ['WSL_DISTRO_NAME', 'WSL_INTEROP'] as const;

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isWsl(): boolean {
  if (process.platform !== 'linux') return false;

  for (const key of WSL_ENV_VARS) {
    if (process.env[key]) return true;
  }

  try {
    const contents = readFileSync('/proc/version', 'utf-8').toLowerCase();
    if (contents.includes('microsoft') || contents.includes('wsl')) {
      return true;
    }
  } catch {
    // Ignore – conservative fallback is "not WSL".
  }

  return false;
}

export function getWindowsRoot(): string | null {
  if (!isWsl()) return null;
  // For now we assume the standard /mnt/c mount; callers can handle null.
  return '/mnt/c';
}

export function toWindowsPath(wslPath: string): string | null {
  if (!wslPath.startsWith('/mnt/')) return null;

  const segments = wslPath.split('/');
  // ['', 'mnt', '<drive>', ...]
  if (segments.length < 4) return null;

  const driveLetter = segments[2];
  if (!/^[a-zA-Z]$/.test(driveLetter)) return null;

  const rest = segments.slice(3).join('\\');
  const drive = driveLetter.toUpperCase();

  return rest ? `${drive}:\\${rest}` : `${drive}:\\`;
}

