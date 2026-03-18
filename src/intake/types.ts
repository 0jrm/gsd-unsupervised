export type IntakeSource = 'cli' | 'dashboard' | 'sms';

export interface RawGoal {
  title: string;
  body?: string;
  source: IntakeSource;
  projectPath: string;
  replyTo?: string;
  receivedAt: string;
}

export interface ComplexityScore {
  score: 1 | 2 | 3 | 4 | 5;
  reasoning: string;
  suggestedQuestions: string[];
}

export interface PendingGoal {
  id: string;
  raw: RawGoal;
  complexity: ComplexityScore;
  draftSpec: string;
  expiresAt: string;
}

export interface QueuedGoal {
  title: string;
  successCriteria: string[];
  scope: string;
  source: IntakeSource;
  queuedAt: string;
}

