export interface StateSnapshot {
  phaseNumber: number;
  totalPhases: number;
  phaseName: string;
  planNumber: number;
  totalPlans: number;
  status: string;
  lastActivity: string;
  /**
   * When present, represents the overall progress percentage parsed from the
   * "Progress:" line in STATE.md. Null when the progress line is missing or
   * has no percentage.
   */
  progressPercent: number | null;
  /**
   * Optional git SHA associated with the snapshot, parsed from a "Git SHA:"
   * line when present. Older STATE.md files may not include this.
   */
  gitSha?: string | null;
}

