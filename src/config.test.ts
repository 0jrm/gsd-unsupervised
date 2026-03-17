import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('config agent', () => {
  it('defaults agent to cursor when not specified', () => {
    const config = loadConfig({ cliOverrides: {} });
    expect(config.agent).toBe('cursor');
  });

  it('accepts agent cursor when explicitly set', () => {
    const config = loadConfig({ cliOverrides: { agent: 'cursor' } });
    expect(config.agent).toBe('cursor');
  });

  it('accepts agent claude-code', () => {
    const config = loadConfig({ cliOverrides: { agent: 'claude-code' } });
    expect(config.agent).toBe('claude-code');
  });

  it('accepts agent gemini-cli', () => {
    const config = loadConfig({ cliOverrides: { agent: 'gemini-cli' } });
    expect(config.agent).toBe('gemini-cli');
  });

  it('accepts agent codex', () => {
    const config = loadConfig({ cliOverrides: { agent: 'codex' } });
    expect(config.agent).toBe('codex');
  });

  it('rejects invalid agent with clear error', () => {
    expect(() => loadConfig({ cliOverrides: { agent: 'bogus-agent' } })).toThrow(
      /Invalid enum value.*Expected 'cursor' \| 'claude-code' \| 'gemini-cli' \| 'codex'.*received 'bogus-agent'/,
    );
  });
});
