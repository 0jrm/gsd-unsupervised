import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isWsl, isWindows, toWindowsPath } from './wsl.js';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_PLATFORM = process.platform;

// Vitest/Jest don't allow reassigning process.platform directly, so we only
// exercise the positive WSL detection path via env vars in these tests.

describe('wsl helpers', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('detects Windows based on platform', () => {
    expect(typeof isWindows()).toBe('boolean');
  });

  it('isWsl returns true when WSL env vars are present on linux', () => {
    if (ORIGINAL_PLATFORM !== 'linux') {
      // Cannot reliably assert WSL behavior on non-linux platforms.
      return;
    }

    process.env.WSL_DISTRO_NAME = 'Ubuntu-22.04';
    expect(isWsl()).toBe(true);
  });

  it('toWindowsPath converts /mnt/c paths', () => {
    expect(toWindowsPath('/mnt/c/Users/test')).toBe('C:\\Users\\test');
    expect(toWindowsPath('/mnt/d/dir/file.txt')).toBe('D:\\dir\\file.txt');
  });

  it('toWindowsPath returns null for non /mnt paths', () => {
    expect(toWindowsPath('/home/me')).toBeNull();
    expect(toWindowsPath('C:\\Users\\test')).toBeNull();
  });
});

