/**
 * Lightweight parsing for cn (Continue CLI) plain-text output.
 * cn does not output NDJSON — completion detection is via exit code.
 */

const ERROR_INDICATORS = ['error:', 'failed'];
const SUMMARY_MAX_LEN = 200;

export interface ParseCnOutputResult {
  hasError: boolean;
  summary: string;
}

/**
 * Parse cn stdout for session log and error detection.
 * @param stdout - Raw stdout from cn process
 * @returns hasError (true if output suggests failure), summary (truncated for log)
 */
export function parseCnOutput(stdout: string): ParseCnOutputResult {
  const trimmed = stdout.trim();
  const lower = trimmed.toLowerCase();

  const hasError =
    ERROR_INDICATORS.some((ind) => lower.includes(ind)) ||
    /^error\b/i.test(trimmed) ||
    /\bfailed\b/i.test(trimmed);

  const summary =
    trimmed.length === 0
      ? 'No output'
      : trimmed.length <= SUMMARY_MAX_LEN
        ? trimmed
        : trimmed.slice(0, SUMMARY_MAX_LEN) + '…';

  return { hasError, summary };
}
