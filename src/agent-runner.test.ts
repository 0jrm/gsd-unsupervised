import { describe, it, expect } from 'vitest';
import { SUPPORTED_AGENTS, isSupportedAgent } from './agent-runner.js';

describe('agent-runner', () => {
  describe('SUPPORTED_AGENTS', () => {
    it('includes cursor, cn, claude-code, gemini-cli, codex', () => {
      expect(SUPPORTED_AGENTS).toContain('cursor');
      expect(SUPPORTED_AGENTS).toContain('cn');
      expect(SUPPORTED_AGENTS).toContain('claude-code');
      expect(SUPPORTED_AGENTS).toContain('gemini-cli');
      expect(SUPPORTED_AGENTS).toContain('codex');
      expect(SUPPORTED_AGENTS).toHaveLength(5);
    });
  });

  describe('isSupportedAgent', () => {
    it('returns true for supported agents', () => {
      expect(isSupportedAgent('cursor')).toBe(true);
      expect(isSupportedAgent('cn')).toBe(true);
      expect(isSupportedAgent('claude-code')).toBe(true);
      expect(isSupportedAgent('gemini-cli')).toBe(true);
      expect(isSupportedAgent('codex')).toBe(true);
    });

    it('returns false for invalid agents', () => {
      expect(isSupportedAgent('bogus-agent')).toBe(false);
      expect(isSupportedAgent('')).toBe(false);
      expect(isSupportedAgent('Cursor')).toBe(false);
    });
  });
});
