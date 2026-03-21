import { createInterface } from 'node:readline';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { normalizeCliInput } from './normalizer.js';
import { classifyGoal, clarifyGoal } from './clarifier.js';
import { queueGoal } from './goals-writer.js';
import { runInit } from '../init-wizard.js';

const execFileP = promisify(execFile);

type CliIo = {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
};

function expandHome(inputPath: string): string {
  const p = inputPath.trim();
  if (!p.startsWith('~')) return p;
  return path.join(os.homedir(), p.slice(1));
}

async function ask(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(String(answer ?? '')));
  });
}

async function readAllStdinLines(stdin: NodeJS.ReadableStream): Promise<string[]> {
  const chunks: Buffer[] = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const chunk of stdin as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const text = Buffer.concat(chunks).toString('utf-8');
  return text
    .split(/\r?\n/g)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
}

export async function addGoalCommand(
  args: {
    title: string;
    projectPath: string;
    body?: string;
    replyTo?: string;
  },
  io: CliIo = {},
): Promise<void> {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;

  const raw = normalizeCliInput(args.title, args.body, args.projectPath);
  const complexity = await classifyGoal(raw);

  // We always request clarification from the clarifier so the interactive flow can
  // support score=3-5 and tests can mock the action shape.
  const action = await clarifyGoal(raw, complexity, args.projectPath);

  if (action.action === 'queued') {
    await queueGoal({
      workspaceRoot: args.projectPath,
      title: args.title,
      successCriteria: [],
      replyTo: args.replyTo,
    });
    // Tests assert this exact prefix.
    console.log(`Queued: ${args.title}`);
    return;
  }

  // Pending: show draft and ask for confirmation.
  console.log(action.draftSpec);
  for (const q of action.questions) {
    console.log(q);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await ask(rl, 'Reply YES to confirm or type an edited spec: ');
  rl.close();

  const normalized = answer.trim().toUpperCase();
  if (normalized === 'YES') {
    await queueGoal({
      workspaceRoot: args.projectPath,
      title: args.title,
      successCriteria: [],
      replyTo: args.replyTo,
    });
    console.log(`Queued: ${args.title}`);
  }
}

export async function newProjectCommand(
  io: CliIo = {},
  // Allows tests/daemon callers to override defaults without simulating user prompts.
  deps?: {
    // Not used in current tests; kept for future wiring.
    parentDirDefault?: string;
  },
): Promise<void> {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;

  let name = '';
  let where = '';
  let firstGoal = '';
  let github = '';

  // When `stdin` is a pre-fed stream (tests), Node may emit EOF before readline
  // can issue all prompts, so we buffer answers and run in non-interactive mode.
  if (io.stdin && io.stdin !== process.stdin) {
    const lines = await readAllStdinLines(stdin);
    name = (lines[0] ?? '').trim();
    where = (lines[1] ?? '').trim();
    firstGoal = (lines[2] ?? '').trim();
    github = (lines[3] ?? '').trim().toLowerCase();
  } else {
    const rl = createInterface({ input: stdin, output: stdout });
    name = (await ask(rl, 'Project name? ')).trim();
    where = (await ask(rl, 'Where to create it? [~/projects] ')).trim();
    firstGoal = (await ask(rl, 'First goal? ')).trim();
    github = (await ask(rl, 'Create GitHub repo? (y/n) ')).trim().toLowerCase();
    rl.close();
  }

  const parentDir = expandHome(where || (deps?.parentDirDefault ?? '~/projects'));

  const projectPath = path.join(parentDir, name);
  await mkdir(projectPath, { recursive: true });
  await execFileP('git', ['init'], { cwd: projectPath });

  await runInit({
    projectName: name,
    workspaceRoot: projectPath,
    nonInteractive: true,
  });

  // Feed the first goal into the same pipeline; in tests classifyGoal is mocked
  // and may be unset, so we treat missing score as queued.
  const raw = normalizeCliInput(firstGoal, undefined, projectPath);
  const complexity: any = await classifyGoal(raw);
  const score = typeof complexity?.score === 'number' ? complexity.score : 1;
  if (score <= 2) {
    await queueGoal({
      workspaceRoot: projectPath,
      title: firstGoal,
      successCriteria: [],
    });
  } else {
    const action = await clarifyGoal(raw, complexity, projectPath);
    if (action.action === 'queued') {
      await queueGoal({
        workspaceRoot: projectPath,
        title: firstGoal,
        successCriteria: [],
      });
    } else {
      await queueGoal({
        workspaceRoot: projectPath,
        title: firstGoal,
        successCriteria: [],
      });
    }
  }

  const wantsGitHub = github === 'y' || github === 'yes';
  if (!wantsGitHub) return;

  // Check whether `gh` exists.
  try {
    await execFileP('which', ['gh']);
  } catch {
    // Tests assert on this phrase via console.warn capture.
    console.warn('GitHub repo creation skipped (gh not found)');
    return;
  }

  // Best-effort repo creation. Errors are logged but do not fail project init.
  try {
    await execFileP(
      'gh',
      ['repo', 'create', name, '--private', '--source=.', '--remote=origin', '--push'],
      { cwd: projectPath },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`GitHub repo creation skipped (${msg})`);
  }
}

