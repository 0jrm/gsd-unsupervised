import { readFile, appendFile } from 'node:fs/promises';

export interface SessionLogEntry {
  timestamp: string;
  goalTitle: string;
  phase: string;
  sessionId: string | null;
  command: string;
  status: 'running' | 'done' | 'crashed' | 'timeout';
  durationMs?: number;
  error?: string;
}

export async function appendSessionLog(logPath: string, entry: SessionLogEntry): Promise<void> {
  const line = JSON.stringify(entry) + '\n';
  await appendFile(logPath, line, { encoding: 'utf-8', flag: 'a' });
}

export async function readSessionLog(logPath: string): Promise<SessionLogEntry[]> {
  let content: string;
  try {
    content = await readFile(logPath, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const entries: SessionLogEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as SessionLogEntry);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

export async function getLastRunningSession(logPath: string): Promise<SessionLogEntry | null> {
  const entries = await readSessionLog(logPath);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].status === 'running') {
      return entries[i];
    }
  }
  return null;
}
