import * as dotenv from 'dotenv';
dotenv.config();
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initLogger, createChildLogger } from './logger.js';
import { loadConfig } from './config.js';
import { loadGoals, getPendingGoals } from './goals.js';
import { runDaemon, registerShutdownHandlers } from './daemon.js';
import { validateCursorApiKey } from './cursor-agent.js';
import { applyWslBootstrap } from './bootstrap/wsl-bootstrap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  const pkgPath = resolve(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

const program = new Command();

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
  .option('--agent <name>', 'Agent type: cursor (default), claude-code, gemini-cli, codex', 'cursor')
  .option('--agent-path <path>', 'Path to cursor-agent binary', 'agent')
  .option('--agent-timeout <ms>', 'Agent invocation timeout in milliseconds', '600000')
  .option('--status-server <port>', 'Enable HTTP status server on port (GET / or /status)', undefined)
  .option('--ngrok', 'Start ngrok tunnel to status server port (use with --status-server)', false)
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

      if (opts.dryRun as boolean) {
        const goals = await loadGoals(config.goalsPath);
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

export function main(): void {
  program.parse();
}

main();
