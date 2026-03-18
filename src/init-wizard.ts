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

export async function runInit(): Promise<void> {
  const cwd = process.cwd();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n  gsd-unsupervised init\n');

  const name = await ask(rl, "? What's this project? (name) ");
  const projectName = name || 'my-project';

  const repoPrompt = await ask(rl, "? Where's the repo? (path or git URL, or Enter for current dir) ");
  const repoPath = repoPrompt || '.';

  const firstGoal = await ask(rl, "? What's your first goal? (freetext) ");
  const goalText = firstGoal ? `- [ ] ${firstGoal}` : '- [ ] Get started with GSD';

  const twilio = await askYesNo(rl, '? Twilio SMS alerts? (y/n) ');
  const ngrok = await askYesNo(rl, '? Public dashboard via ngrok? (y/n) ');

  rl.close();

  const workspaceRoot = resolve(cwd, repoPath);
  const gsdDir = resolve(workspaceRoot, '.gsd');
  await mkdir(gsdDir, { recursive: true });

  let isSelf = false;
  try {
    const pkg = JSON.parse(await readFile(resolve(workspaceRoot, 'package.json'), 'utf-8'));
    isSelf = pkg.name === 'gsd-unsupervised';
  } catch {
    // not this repo or no package.json
  }
  const mode: GsdMode = isSelf ? 'self' : 'project';

  const goalsPath = mode === 'project' ? '.gsd/goals.md' : './goals.md';

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
