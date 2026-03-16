import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  const pkgPath = resolve(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

const program = new Command();

program
  .name('gsd-autopilot')
  .description('Autonomous orchestrator for Cursor agent + GSD framework')
  .version(getVersion())
  .option('--goals <path>', 'Path to goals.md file', './goals.md')
  .option('--config <path>', 'Path to config JSON file', './.autopilot/config.json')
  .option('--parallel', 'Enable parallel project execution', false)
  .option('--max-concurrent <n>', 'Max concurrent projects when parallel', '3')
  .option('--verbose', 'Enable verbose/debug logging', false)
  .option('--dry-run', 'Parse goals and show plan without executing', false)
  .action((opts) => {
    console.log('gsd-autopilot starting with options:');
    console.log(JSON.stringify(opts, null, 2));
    // Stub: daemon loop (Plan 03) will replace this
  });

export function main(): void {
  program.parse();
}

main();
