import * as dotenv from 'dotenv';
dotenv.config();
import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initLogger, createChildLogger } from './logger.js';
import { loadConfig } from './config.js';
import { loadGoals, getPendingGoals } from './goals.js';
import { runDaemon, registerShutdownHandlers } from './daemon.js';
import { validateCursorApiKey, validateContinueApiKey } from './cursor-agent.js';
import { sendSms } from './notifier.js';
import { applyWslBootstrap } from './bootstrap/wsl-bootstrap.js';
import { readGsdStateFromPath } from './gsd-state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  const pkgPath = resolve(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

const program = new Command();

/** Default action: legacy direct daemon (goals, status-server, etc.). */
program
  .name('gsd-unsupervised')
  .description('Autonomous orchestrator for Cursor agent + GSD framework')
  .version(getVersion())
  .option('--goals <path>', 'Path to goals.md file', './goals.md')
  .option('--config <path>', 'Path to config JSON file', './.autopilot/config.json')
  .option('--parallel', 'Enable parallel project execution', false)
  .option('--max-concurrent <n>', 'Max concurrent projects when parallel', '3')
  .option('--verbose', 'Enable verbose/debug logging', false)
  .option('--dry-run', 'Parse goals and show plan without executing', false)
  .option('--agent <name>', 'Agent type: cursor (default), cn, claude-code, gemini-cli, codex', 'cursor')
  .option('--agent-path <path>', 'Path to cursor-agent binary', 'agent')
  .option('--agent-timeout <ms>', 'Agent invocation timeout in milliseconds', '600000')
  .option('--status-server <port>', 'Enable HTTP status server on port (GET / or /status)', undefined)
  .option('--ngrok', 'Start ngrok tunnel to status server port (use with --status-server)', false)
  .option('--ignore-planning-config', 'Do not apply overrides from .planning/config.json', false)
  .action(async (opts) => {
    const verbose = opts.verbose as boolean;
    const logger = initLogger({
      level: verbose ? 'debug' : 'info',
      pretty: verbose,
    });
    const log = createChildLogger(logger, 'cli');

    try {
      const config = loadConfig({
        configPath: opts.config as string,
        cliOverrides: {
          goalsPath: opts.goals as string,
          parallel: opts.parallel as boolean,
          maxConcurrent: parseInt(opts.maxConcurrent as string, 10),
          verbose,
          agent: opts.agent as string,
          cursorAgentPath: opts.agentPath as string,
          agentTimeoutMs: parseInt(opts.agentTimeout as string, 10),
          statusServerPort: opts.statusServer ? parseInt(opts.statusServer as string, 10) : undefined,
          ngrok: opts.ngrok as boolean,
        },
        ignorePlanningConfig: opts.ignorePlanningConfig as boolean,
        logger: log,
      });

      log.debug({ config }, 'Configuration loaded');

      const resolvedEnv = applyWslBootstrap(config);
      log.debug(
        {
          isWsl: resolvedEnv.isWsl,
          cursorBinaryPath: resolvedEnv.cursorBinaryPath,
          clipExePath: resolvedEnv.clipExePath ?? undefined,
          workspace: resolvedEnv.workspace,
        },
        'Resolved environment for current platform',
      );

      if (!(opts.dryRun as boolean) && config.agent === 'cursor') {
        try {
          validateCursorApiKey();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`Error: ${message}\n`);
          process.exit(1);
        }
      }
      if (!(opts.dryRun as boolean) && config.agent === 'cn') {
        try {
          validateContinueApiKey();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`Error: ${message}\n`);
          process.exit(1);
        }
      }

      if (opts.dryRun as boolean) {
        const goals = await loadGoals(config.goalsPath, { logger: log });
        const pending = getPendingGoals(goals);

        console.log('\n  Goals Queue Summary');
        console.log('  ' + '─'.repeat(60));
        console.log(
          '  ' +
            'Title'.padEnd(50) +
            'Status',
        );
        console.log('  ' + '─'.repeat(60));
        for (const g of goals) {
          console.log(
            '  ' +
              g.title.slice(0, 49).padEnd(50) +
              g.status,
          );
        }
        console.log('  ' + '─'.repeat(60));
        console.log(`  Total: ${goals.length}  |  Pending: ${pending.length}\n`);
        return;
      }

      registerShutdownHandlers(logger);
      await runDaemon(config, logger);
    } catch (err) {
      log.error({ err }, 'Fatal error');
      process.exit(1);
    }
  });

/** Run daemon from .gsd/state.json (used by ./run script). */
program
  .command('run')
  .description('Start daemon using .gsd/state.json (single source of truth)')
  .option('--state <path>', 'Path to .gsd/state.json', undefined)
  .option('--verbose', 'Verbose logging', false)
  .option('--ignore-planning-config', 'Do not apply overrides from .planning/config.json', false)
  .action(async (opts) => {
    const cwd = process.cwd();
    const statePath = opts.state
      ? resolve(cwd, opts.state)
      : resolve(cwd, '.gsd', 'state.json');
    if (!existsSync(statePath)) {
      console.error('No state found. Run: npx gsd-unsupervised init');
      process.exit(1);
    }
    const projectRoot = dirname(dirname(statePath));
    const state = await readGsdStateFromPath(statePath, projectRoot);
    if (!state) {
      console.error('Invalid or empty state at', statePath);
      process.exit(1);
    }
    const workspaceRoot = resolve(projectRoot, state.workspaceRoot);
    const goalsPath = state.goalsPath.startsWith('/')
      ? state.goalsPath
      : resolve(workspaceRoot, state.goalsPath);
    const verbose = opts.verbose as boolean;
    const logger = initLogger({ level: verbose ? 'debug' : 'info', pretty: verbose });
    const log = createChildLogger(logger, 'cli');
    try {
      const config = loadConfig({
        cliOverrides: {
          workspaceRoot,
          goalsPath,
          statusServerPort: state.statusServerPort,
          statePath,
          verbose,
        },
        ignorePlanningConfig: opts.ignorePlanningConfig as boolean,
        logger: log,
      });
      log.info(
        { mode: state.mode, project: state.project, goalsPath: config.goalsPath },
        'Resuming from state',
      );
      if (config.agent === 'cursor') {
        try {
          validateCursorApiKey();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`Error: ${message}\n`);
          process.exit(1);
        }
      }
      registerShutdownHandlers(logger);
      await runDaemon(config, logger);
    } catch (err) {
      log.error({ err }, 'Fatal error');
      process.exit(1);
    }
  });

/** Onboarding wizard: create .gsd/ and goals. */
program
  .command('init')
  .description('Onboarding wizard: project name, repo path, first goal, Twilio/ngrok config')
  .action(async () => {
    const { runInit } = await import('./init-wizard.js');
    await runInit();
  });

/** Add a goal to an existing project with optional interactive clarification. */
program
  .command('add-goal <title>')
  .description('Add a new goal to goals.md')
  .option('--project <path>', 'Path to the target workspace/project root', process.cwd())
  .option('--body <text>', 'Optional goal details', undefined)
  .action(async (title: string, opts) => {
    const { addGoalCommand } = await import('./intake/cli-commands.js');
    await addGoalCommand({
      title,
      projectPath: opts.project as string,
      body: (opts.body as string | undefined) ?? undefined,
      replyTo: undefined,
    });
  });

/** Interactive wizard: create project folder, init git, and queue first goal. */
program
  .command('new-project')
  .description('Create a new project folder and queue the first goal')
  .action(async () => {
    const { newProjectCommand } = await import('./intake/cli-commands.js');
    await newProjectCommand();
  });

/** Send a test SMS to verify Twilio config (TWILIO_* in .env or env). */
program
  .command('test-sms')
  .description('Send a test SMS to verify Twilio credentials and delivery')
  .option('--message <text>', 'Custom message (default: GSD Autopilot test message)', undefined)
  .action(async (opts) => {
    const message =
      (opts.message as string | undefined)?.trim() ||
      'GSD Autopilot test SMS. If you received this, notifications are working.';
    try {
      await sendSms(message);
      console.log('Test SMS sent successfully. Check your phone (TWILIO_TO).');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Failed to send test SMS:', msg);
      console.error('');
      console.error('Check: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, TWILIO_TO in .env or environment.');
      process.exit(1);
    }
  });

/** Send all three notification types in sequence (1s delay) to verify full SMS set. */
program
  .command('test-sms-all')
  .description('Send Started, goal complete, and Crashed test SMSes in sequence (1s apart)')
  .action(async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const goalTitle = 'Test goal';
    try {
      await sendSms(`[gsd] Started: ${goalTitle} — phase 1`);
      console.log('1/3 Sent: Started');
      await sleep(1000);
      await sendSms(`GSD goal complete.\nGoal: ${goalTitle}`);
      console.log('2/3 Sent: Goal complete');
      await sleep(1000);
      await sendSms(`[gsd] Crashed: ${goalTitle} — phase 2, plan 1. Check logs.`);
      console.log('3/3 Sent: Crashed');
      console.log('All three test SMSes sent. Check your phone (TWILIO_TO).');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Failed to send test SMS:', msg);
      console.error('');
      console.error('Check: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, TWILIO_TO in .env or environment.');
      process.exit(1);
    }
  });

export function main(): void {
  program.parse();
}

main();
