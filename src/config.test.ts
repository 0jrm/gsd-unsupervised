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

  it('rejects claude-code with clear error', () => {
    expect(() => loadConfig({ cliOverrides: { agent: 'claude-code' } })).toThrow(
      /Invalid enum value.*received 'claude-code'/,
    );
  });

  it('rejects gemini-cli with clear error', () => {
    expect(() => loadConfig({ cliOverrides: { agent: 'gemini-cli' } })).toThrow(
      /Invalid enum value.*received 'gemini-cli'/,
    );
  });

  it('accepts agent codex', () => {
    const config = loadConfig({ cliOverrides: { agent: 'codex' } });
    expect(config.agent).toBe('codex');
  });

  it('accepts agent cn', () => {
    const config = loadConfig({ cliOverrides: { agent: 'cn' } });
    expect(config.agent).toBe('cn');
  });

  it('rejects invalid agent with clear error', () => {
    expect(() => loadConfig({ cliOverrides: { agent: 'bogus-agent' } })).toThrow(
      /Invalid enum value.*received 'bogus-agent'/,
    );
  });
});
