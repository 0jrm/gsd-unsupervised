/**
 * Onboarding wizard for gsd-unsupervised: one command, minimal questions.
 * Writes .gsd/state.json, goals (goals.md or .gsd/goals.md), .env, and config.
 */

import { createInterface } from 'node:readline';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname as pathDirname } from 'node:path';
import { writeGsdState, type GsdMode } from './gsd-state.js';

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((res) => {
    rl.question(question, (answer) => res((answer ?? '').trim()));
  });
}

function askYesNo(rl: ReturnType<typeof createInterface>, question: string): Promise<boolean> {
  return new Promise((res) => {
    rl.question(question, (answer) => {
      const a = (answer ?? '').trim().toLowerCase();
      res(a === 'y' || a === 'yes' || a === '1');
    });
  });
}

export type NonInteractiveInitOptions = {
  nonInteractive: true;
  projectName: string;
  workspaceRoot: string;
  firstGoal?: string;
  twilio?: boolean;
  ngrok?: boolean;
};

/** Simple init options (setup.sh-style): agent, goals path, port. */
export type SimpleInitOptions = {
  agent?: string;
  goals?: string;
  port?: number;
};

export async function runInit(options?: NonInteractiveInitOptions): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n  gsd-unsupervised init\n');

  let projectName = 'my-project';
  let workspaceRoot = process.cwd();
  let goalText = '- [ ] Get started with GSD';
  let twilio = false;
  let ngrok = false;

  if (options?.nonInteractive) {
    projectName = options.projectName;
    workspaceRoot = options.workspaceRoot;
    goalText = options.firstGoal ? `- [ ] ${options.firstGoal}` : '- [ ] Get started with GSD';
    twilio = Boolean(options.twilio);
    ngrok = Boolean(options.ngrok);
    rl.close();
  } else {
    const cwd = process.cwd();

    const name = await ask(rl, "? What's this project? (name) ");
    projectName = name || 'my-project';

    const repoPrompt = await ask(rl, "? Where's the repo? (path or git URL, or Enter for current dir) ");
    const repoPath = repoPrompt || '.';

    const firstGoal = await ask(rl, "? What's your first goal? (freetext) ");
    goalText = firstGoal ? `- [ ] ${firstGoal}` : '- [ ] Get started with GSD';

    twilio = await askYesNo(rl, '? Twilio SMS alerts? (y/n) ');
    ngrok = await askYesNo(rl, '? Public dashboard via ngrok? (y/n) ');

    rl.close();
    workspaceRoot = resolve(cwd, repoPath);
  }
  const gsdDir = resolve(workspaceRoot, '.gsd');
  await mkdir(gsdDir, { recursive: true });

  let isSelf = false;
  try {
    const pkg = JSON.parse(await readFile(resolve(workspaceRoot, 'package.json'), 'utf-8'));
    isSelf = pkg.name === 'gsd-unsupervised';
  } catch {
    // not this repo or no package.json
  }
  // GSD intake/daemon hot-reload expects `goals.md` at the project root.
  // Keep `mode` for any legacy/state consumers, but always write root `goals.md`.
  const mode: GsdMode = isSelf ? 'self' : 'project';
  const goalsPath = './goals.md';

  const state = {
    mode,
    project: projectName,
    workspaceRoot,
    goalsPath,
    statusServerPort: 3000,
    ...(ngrok && { ngrokUrl: '' }),
  };

  const statePath = resolve(gsdDir, 'state.json');
  await writeGsdState(workspaceRoot, state, statePath);

  const goalsFile = resolve(workspaceRoot, goalsPath);
  const goalsContent = `# GSD Autopilot Goals Queue

## Pending
${goalText}

## In Progress
<!-- orchestrator moves goals here while running -->

## Done
<!-- orchestrator moves goals here on completion -->
`;
  await mkdir(pathDirname(goalsFile), { recursive: true }).catch(() => {});
  await writeFile(goalsFile, goalsContent, 'utf-8');

  const envPath = resolve(workspaceRoot, '.env');
  let envLines: string[] = [];
  if (existsSync(envPath)) {
    const raw = await readFile(envPath, 'utf-8');
    envLines = raw.split('\n').filter((l) => !l.startsWith('TWILIO_'));
  }
  if (twilio) {
    envLines.push('# Twilio SMS (fill in values)');
    envLines.push('TWILIO_ACCOUNT_SID=');
    envLines.push('TWILIO_AUTH_TOKEN=');
    envLines.push('TWILIO_FROM=');
    envLines.push('TWILIO_TO=');
    envLines.push('# ngrok URL + /webhook/sms — needed for two-way SMS');
    envLines.push('TWILIO_WEBHOOK_URL=');
  }
  if (envLines.length > 0) {
    await writeFile(envPath, envLines.join('\n') + '\n', 'utf-8');
  }

  if (ngrok) {
    const configPath = resolve(gsdDir, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({ useNgrok: true, statusServerPort: 3000 }, null, 2),
      'utf-8',
    );
  }

  console.log('\n  ✓ Created .gsd/ config');
  console.log('  ✓ Created goals with your first goal');
  console.log('  ✓ Run: ./run to start\n');
}

/**
 * Simple non-interactive init (setup.sh logic): writes .gsd/state.json and goals.md.
 * Used when init is called with --agent, --goals, or --port flags.
 */
export async function runSimpleInit(options: SimpleInitOptions): Promise<void> {
  const cwd = process.cwd();
  const agent = options.agent ?? 'cursor';
  const goalsPath = options.goals ?? './goals.md';
  const port = options.port ?? 3000;

  const gsdDir = resolve(cwd, '.gsd');
  await mkdir(gsdDir, { recursive: true });

  const state = {
    mode: 'self' as GsdMode,
    project: 'gsd-unsupervised',
    agent,
    goalsPath,
    statusServerPort: port,
    workspaceRoot: '.',
    createdAt: new Date().toISOString(),
  };

  const statePath = resolve(gsdDir, 'state.json');
  await writeGsdState(cwd, state, statePath);

  const goalsFile = resolve(cwd, goalsPath.startsWith('./') ? goalsPath.slice(2) : goalsPath);
  if (!existsSync(goalsFile)) {
    await mkdir(pathDirname(goalsFile), { recursive: true }).catch(() => {});
    await writeFile(
      goalsFile,
      `# Goals

## Pending
- [ ] My first goal — describe what you want to build

## In Progress

## Done
`,
      'utf-8',
    );
  }

  console.log('\n  ✓ Initialized! Next steps:');
  console.log('    1. Edit goals.md and add your first goal');
  console.log('    2. Run ./run to start the daemon');
  console.log('    3. Run: tmux attach -t gsd-self  to watch it work\n');
}
