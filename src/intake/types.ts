export type IntakeSource = 'cli' | 'dashboard' | 'sms';

export interface RawGoal {
  title: string;
  body?: string;
  source: IntakeSource;
  projectPath: string;
  replyTo?: string;
  receivedAt: string;
}
