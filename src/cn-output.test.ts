import { describe, it, expect } from 'vitest';
import { parseCnOutput } from './cn-output.js';

describe('parseCnOutput', () => {
  it('returns hasError false and "No output" for empty string', () => {
    const result = parseCnOutput('');
    expect(result.hasError).toBe(false);
    expect(result.summary).toBe('No output');
  });

  it('returns hasError true when output contains "Error:"', () => {
    const result = parseCnOutput('Error: something went wrong');
    expect(result.hasError).toBe(true);
    expect(result.summary).toContain('Error:');
  });

  it('returns hasError true when output contains "Failed"', () => {
    const result = parseCnOutput('Operation Failed to complete');
    expect(result.hasError).toBe(true);
  });

  it('returns hasError false and truncated summary for normal output', () => {
    const longOutput = 'x'.repeat(300);
    const result = parseCnOutput(longOutput);
    expect(result.hasError).toBe(false);
    expect(result.summary).toHaveLength(201);
    expect(result.summary.endsWith('…')).toBe(true);
  });

  it('returns full output when under 200 chars', () => {
    const short = 'Hello world';
    const result = parseCnOutput(short);
    expect(result.hasError).toBe(false);
    expect(result.summary).toBe('Hello world');
  });
});
