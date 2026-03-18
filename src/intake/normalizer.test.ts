import { describe, it, expect } from 'vitest';
import type { RawGoal } from './types.js';
import { normalizeCliInput, normalizeDashboardInput, normalizeSmsInput } from './normalizer.js';

function expectValidIsoString(s: string): void {
  const d = new Date(s);
  expect(Number.isNaN(d.getTime())).toBe(false);
  // Basic ISO-8601 UTC shape check (what `toISOString()` produces).
  expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
}

describe('intake/normalizer', () => {
  it('normalizeCliInput: returns RawGoal with source cli', () => {
    const raw = normalizeCliInput('fix auth bug', undefined, '/proj') as RawGoal;
    expect(raw.source).toBe('cli');
    expect(raw.title).toBe('fix auth bug');
    expect(raw.replyTo).toBeUndefined();
    expect(raw.projectPath).toBe('/proj');
    expectValidIsoString(raw.receivedAt);
  });

  it('normalizeDashboardInput: returns RawGoal with source dashboard', () => {
    const raw = normalizeDashboardInput({ title: 'add dark mode', body: 'details' }, '/proj') as RawGoal;
    expect(raw.source).toBe('dashboard');
    expect(raw.title).toBe('add dark mode');
    expect(raw.body).toBe('details');
    expect(raw.replyTo).toBeUndefined();
    expect(raw.projectPath).toBe('/proj');
    expectValidIsoString(raw.receivedAt);
  });

  it('normalizeSmsInput: returns RawGoal with source sms and replyTo', () => {
    const raw = normalizeSmsInput('add dark mode', '+15551234567', '/proj') as RawGoal;
    expect(raw.source).toBe('sms');
    expect(raw.title).toBe('add dark mode');
    expect(raw.replyTo).toBe('+15551234567');
    expect(raw.projectPath).toBe('/proj');
    expectValidIsoString(raw.receivedAt);
  });
});

