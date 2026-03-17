import path from 'node:path';
import { writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AutopilotConfig } from './config.js';
import type { Logger } from './logger.js';
import type { Goal } from './goals.js';
import type { SessionLogContext } from './session-log.js';
import { createChildLogger } from './logger.js';
import {
  GoalLifecyclePhase,
  GoalStateMachine,
  type GsdCommand,
} from './lifecycle.js';
import {
  parseRoadmap,
  findPhaseDir,
  discoverPlans,
  getNextUnexecutedPlan,
} from './roadmap-parser.js';
import { isWorkingTreeClean, createCheckpoint } from './git.js';
import { readStateFile } from './state-index.js';
import type { StateSnapshot } from './state-types.js';
import type { ResumeFrom } from './session-log.js';
import { sendSms } from './notifier.js';
import { waitForHeadroom } from './resource-governor.js';

const execFileP = promisify(execFile);

async function getGitSha(workspaceRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], {
      cwd: workspaceRoot,
      encoding: 'utf-8',
    });
    const sha = stdout.trim();
    return sha || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function reportProgress(options: {
  stateMdPath: string;
  logger: Logger;
  onProgress?: (snapshot: StateSnapshot) => void;
  expectedPhase: number;
  expectedSummaryPath?: string;
}): Promise<void> {
  const { stateMdPath, logger, onProgress, expectedPhase, expectedSummaryPath } = options;

  const snapshot = await readStateFile(stateMdPath, logger);
  if (snapshot === null) return;

  if (onProgress) {
    onProgress(snapshot);
  }

  if (snapshot.phaseNumber !== expectedPhase) {
    logger.warn(
      {
        expectedPhase,
        actualPhase: snapshot.phaseNumber,
        actualPhaseName: snapshot.phaseName,
        plan: snapshot.planNumber,
        status: snapshot.status,
      },
      'STATE.md phase mismatch with orchestrator expectation',
    );
  }

  if (expectedSummaryPath) {
    const ok = existsSync(expectedSummaryPath);
    if (!ok) {
      logger.warn(
        { expectedSummaryPath },
        'Expected SUMMARY file not found after successful agent call',
      );
    }
  }
}

async function writeDaemonStateMd(options: {
  stateMdPath: string;
  phaseNumber: number;
  totalPhases: number;
  phaseName: string;
  planNumber: number;
  totalPlans: number;
  status: string;
  lastActivity: string;
  gitSha: string;
}): Promise<void> {
  const {
    stateMdPath,
    phaseNumber,
    totalPhases,
    phaseName,
    planNumber,
    totalPlans,
    status,
    lastActivity,
    gitSha,
  } = options;

  const content = [
    '# STATE',
    '',
    '## Current Position',
    '',
    `Phase: ${phaseNumber} of ${totalPhases} (${phaseName})`,
    `Plan: ${planNumber} of ${totalPlans} in current phase`,
    `Status: ${status}`,
    `Last activity: ${lastActivity}`,
    '',
    `Git SHA: ${gitSha}`,
    '',
  ].join('\n');

  await writeFile(stateMdPath, content, 'utf-8');
}

export interface AgentResult {
  success: boolean;
  output?: string;
  error?: string;
}

export type AgentInvoker = (
  command: GsdCommand,
  workspaceDir: string,
  logger: Logger,
  logContext?: SessionLogContext,
) => Promise<AgentResult>;

const stubAgent: AgentInvoker = async (command, workspaceDir, logger, _logContext) => {
  logger.info(
    `Stub: would invoke cursor-agent with "${command.command} ${command.args ?? ''}" in ${workspaceDir}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  return { success: true, output: 'stub' };
};

export async function orchestrateGoal(options: {
  goal: Goal;
  config: AutopilotConfig;
  logger: Logger;
  agent?: AgentInvoker;
  isShuttingDown: () => boolean;
  onProgress?: (snapshot: StateSnapshot) => void;
  /** When set, orchestrator will resume from this phase/plan (used in 05-03). */
  resumeFrom?: ResumeFrom | null;
  /**
   * Hint to skip re-running /gsd/plan-phase for phases before this 1-based phase index.
   * Plans will still be discovered/executed for skipped phases.
   */
  skipToPhase?: number | null;
}): Promise<void> {
  const { goal, config, isShuttingDown, onProgress, resumeFrom, skipToPhase } = options;
  const logger = createChildLogger(options.logger, 'orchestrator');
  const agentComponent =
    config.agent === 'cursor' ? 'cursor-agent' : config.agent;
  const agentLogger = createChildLogger(options.logger, agentComponent);
  const agent = options.agent ?? stubAgent;
  const sm = new GoalStateMachine(goal.title);
  const stateMdPath = path.join(config.workspaceRoot, '.planning', 'STATE.md');

  /** Before execute-plan: ensure clean git or create checkpoint when config allows. */
  async function ensureCleanGitOrCheckpoint(): Promise<void> {
    if (!config.requireCleanGitBeforePlan) return;
    const clean = await isWorkingTreeClean(config.workspaceRoot, {
      ignorePaths: [
        '.planning/STATE.md',
        '.planning/heartbeat.txt',
        'session-log.jsonl',
      ],
    });
    if (clean) return;
    if (config.autoCheckpoint) {
      logger.info('Working tree dirty — creating checkpoint commit');
      await createCheckpoint(config.workspaceRoot, 'chore(autopilot): checkpoint before plan');
      return;
    }
    throw new Error(
      'Git working tree is dirty. Commit or stash changes, or set autoCheckpoint: true to create a checkpoint before each plan.',
    );
  }

  async function waitForCpuHeadroom(): Promise<void> {
    await waitForHeadroom({
      maxCpuFraction: config.maxCpuFraction,
      maxMemoryFraction: config.maxMemoryFraction,
      logger,
    });
  }

  try {
    const roadmapPath = path.join(config.workspaceRoot, '.planning', 'ROADMAP.md');
    const gitSha = await getGitSha(config.workspaceRoot);
    let result: AgentResult = { success: true };

    if (resumeFrom && resumeFrom.phaseNumber >= 1 && resumeFrom.planNumber >= 0) {
      const phases = await parseRoadmap(roadmapPath);
      const totalPhases = phases.length;
      if (resumeFrom.phaseNumber > totalPhases) {
        logger.error(
          { resumeFrom: resumeFrom.phaseNumber, totalPhases },
          'resumeFrom.phaseNumber out of range',
        );
        sm.fail(`resumeFrom phase ${resumeFrom.phaseNumber} exceeds total phases ${totalPhases}`);
        return;
      }
      logger.info(
        { phaseNumber: resumeFrom.phaseNumber, planNumber: resumeFrom.planNumber },
        'Resuming from phase %s plan %s due to previous crash',
        resumeFrom.phaseNumber,
        resumeFrom.planNumber === 0 ? '1 (first)' : resumeFrom.planNumber,
      );
      sm.advance(GoalLifecyclePhase.InitializingProject);
      sm.advance(GoalLifecyclePhase.CreatingRoadmap);
      sm.setPhaseInfo(1, totalPhases);
      await writeDaemonStateMd({
        stateMdPath,
        phaseNumber: 1,
        totalPhases,
        phaseName: phases[0]?.name ?? 'Roadmap',
        planNumber: 0,
        totalPlans: 0,
        status: 'Resuming',
        lastActivity: new Date().toISOString(),
        gitSha,
      });

      for (let i = 0; i < resumeFrom.phaseNumber - 1; i++) {
        if (isShuttingDown()) {
          logShutdown(logger, sm);
          return;
        }
        sm.advance(GoalLifecyclePhase.PlanningPhase);
        sm.advance(GoalLifecyclePhase.PhaseComplete);
        sm.setPhaseInfo(i + 2, totalPhases);
      }

      const phase = phases[resumeFrom.phaseNumber - 1];
      const phaseNum = resumeFrom.phaseNumber;
      sm.advance(GoalLifecyclePhase.PlanningPhase);

      const phasesRoot = path.join(config.workspaceRoot, '.planning', 'phases');
      const phaseDir = findPhaseDir(phasesRoot, phase.number);
      if (!phaseDir) {
        logger.error({ phase: phase.number }, 'Phase directory not found for resume');
        sm.fail(`Phase directory not found for phase ${phase.number}`);
        return;
      }

      let plans = await discoverPlans(phaseDir);
      const targetPlan =
        resumeFrom.planNumber === 0
          ? getNextUnexecutedPlan(plans)
          : plans.find((p) => p.planNumber === resumeFrom.planNumber);
      if (!targetPlan) {
        if (resumeFrom.planNumber === 0) {
          sm.advance(GoalLifecyclePhase.PhaseComplete);
          sm.setPhaseInfo(phaseNum + 1, totalPhases);
          for (let i = phaseNum; i < totalPhases; i++) {
            if (isShuttingDown()) {
              logShutdown(logger, sm);
              return;
            }
            const p = phases[i];
            const pNum = i + 1;
            sm.advance(GoalLifecyclePhase.PlanningPhase);
            const planCmd: GsdCommand = {
              command: '/gsd/plan-phase',
              args: String(p.number),
              description: `Plan phase ${p.number}`,
            };
            sm.setLastCommand(planCmd);
            const planResult = await agent(planCmd, config.workspaceRoot, agentLogger, {
              goalTitle: goal.title,
              phaseNumber: pNum,
            });
            if (!planResult.success) {
              sm.fail(planResult.error ?? 'Agent failed');
              try {
                await sendSms(
                  `GSD goal failed.\nGoal: ${goal.title}\nError: ${planResult.error ?? 'Agent failed'}`,
                );
              } catch (smsErr) {
                logger.warn({ err: smsErr }, 'SMS notification failed');
              }
              return;
            }
            await writeDaemonStateMd({
              stateMdPath,
              phaseNumber: pNum,
              totalPhases,
              phaseName: p.name,
              planNumber: 0,
              totalPlans: 0,
              status: `Planned phase ${p.number}`,
              lastActivity: new Date().toISOString(),
              gitSha: await getGitSha(config.workspaceRoot),
            });
            await reportProgress({
              stateMdPath,
              logger,
              onProgress,
              expectedPhase: pNum,
            });
            const pDir = findPhaseDir(phasesRoot, p.number);
            if (!pDir) {
              sm.advance(GoalLifecyclePhase.PhaseComplete);
              sm.setPhaseInfo(pNum + 1, totalPhases);
              continue;
            }
            let pPlans = await discoverPlans(pDir);
            sm.setPlanInfo(1, pPlans.length);
            let pNext = getNextUnexecutedPlan(pPlans);
            while (pNext) {
              if (isShuttingDown()) {
                logShutdown(logger, sm);
                return;
              }
              await ensureCleanGitOrCheckpoint();
              await waitForCpuHeadroom();
              sm.advance(GoalLifecyclePhase.ExecutingPlan);
              const exec: GsdCommand = {
                command: '/gsd/execute-plan',
                args: pNext.planPath,
                description: `Execute plan ${pNext.planNumber}`,
              };
              sm.setLastCommand(exec);
              const execResult = await agent(exec, config.workspaceRoot, agentLogger, {
                goalTitle: goal.title,
                phaseNumber: pNum,
                planNumber: pNext.planNumber,
              });
              if (!execResult.success) {
                sm.fail(execResult.error ?? 'Agent failed');
                try {
                  await sendSms(
                    `GSD goal failed.\nGoal: ${goal.title}\nError: ${execResult.error ?? 'Agent failed'}`,
                  );
                } catch (smsErr) {
                  logger.warn({ err: smsErr }, 'SMS notification failed');
                }
                return;
              }
              await writeDaemonStateMd({
                stateMdPath,
                phaseNumber: pNum,
                totalPhases,
                phaseName: p.name,
                planNumber: pNext.planNumber,
                totalPlans: pPlans.length,
                status: `Executed plan ${pNext.planNumber}`,
                lastActivity: new Date().toISOString(),
                gitSha: await getGitSha(config.workspaceRoot),
              });
              await reportProgress({
                stateMdPath,
                logger,
                onProgress,
                expectedPhase: pNum,
                expectedSummaryPath: pNext.summaryPath,
              });
              sm.setPlanInfo(pNext.planNumber + 1, pPlans.length);
              pPlans = await discoverPlans(pDir);
              pNext = getNextUnexecutedPlan(pPlans);
            }
            sm.advance(GoalLifecyclePhase.PhaseComplete);
            sm.setPhaseInfo(pNum + 1, totalPhases);
          }
          sm.advance(GoalLifecyclePhase.Complete);
          logger.info({ goal: goal.title }, `Goal complete: ${goal.title}`);
          await writeDaemonStateMd({
            stateMdPath,
            phaseNumber: totalPhases,
            totalPhases,
            phaseName: phases[totalPhases - 1]?.name ?? 'Complete',
            planNumber: 0,
            totalPlans: 0,
            status: 'Complete',
            lastActivity: new Date().toISOString(),
            gitSha: await getGitSha(config.workspaceRoot),
          });
          try {
            await sendSms(`GSD goal complete.\nGoal: ${goal.title}`);
          } catch (smsErr) {
            logger.warn({ err: smsErr }, 'SMS notification failed');
          }
          return;
        }
        logger.error(
          { phaseNumber: resumeFrom.phaseNumber, planNumber: resumeFrom.planNumber, plans: plans.map((p) => p.planNumber) },
          'Resume target plan not found',
        );
        sm.fail(`Plan ${resumeFrom.planNumber} not found in phase ${resumeFrom.phaseNumber}`);
        return;
      }

      if (isShuttingDown()) {
        logShutdown(logger, sm);
        return;
      }
      await ensureCleanGitOrCheckpoint();
      await waitForCpuHeadroom();
      sm.advance(GoalLifecyclePhase.ExecutingPlan);
      const execCmd: GsdCommand = {
        command: '/gsd/execute-plan',
        args: targetPlan.planPath,
        description: `Execute plan ${targetPlan.planNumber} (resume retry)`,
      };
      sm.setLastCommand(execCmd);
      logger.info(
        { cmd: execCmd.command, plan: targetPlan.planNumber },
        `Resume: ${execCmd.command} ${execCmd.args}`,
      );
      let result = await agent(execCmd, config.workspaceRoot, agentLogger, {
        goalTitle: goal.title,
        phaseNumber: phaseNum,
        planNumber: targetPlan.planNumber,
      });
      if (!result.success) {
        sm.fail(result.error ?? 'Agent failed');
        try {
          await sendSms(`GSD goal failed.\nGoal: ${goal.title}\nError: ${result.error ?? 'Agent failed'}`);
        } catch (smsErr) {
          logger.warn({ err: smsErr }, 'SMS notification failed');
        }
        return;
      }
      await writeDaemonStateMd({
        stateMdPath,
        phaseNumber: phaseNum,
        totalPhases,
        phaseName: phase.name,
        planNumber: targetPlan.planNumber,
        totalPlans: plans.length,
        status: `Executed plan ${targetPlan.planNumber}`,
        lastActivity: new Date().toISOString(),
        gitSha: await getGitSha(config.workspaceRoot),
      });
      await reportProgress({
        stateMdPath,
        logger,
        onProgress,
        expectedPhase: phaseNum,
        expectedSummaryPath: targetPlan.summaryPath,
      });
      sm.setPlanInfo(targetPlan.planNumber + 1, plans.length);
      plans = await discoverPlans(phaseDir);
      let nextPlan = getNextUnexecutedPlan(plans);

      while (nextPlan) {
        if (isShuttingDown()) {
          logShutdown(logger, sm);
          return;
        }
        await ensureCleanGitOrCheckpoint();
        await waitForCpuHeadroom();
        sm.advance(GoalLifecyclePhase.ExecutingPlan);
        const cmd: GsdCommand = {
          command: '/gsd/execute-plan',
          args: nextPlan.planPath,
          description: `Execute plan ${nextPlan.planNumber}`,
        };
        sm.setLastCommand(cmd);
        logger.info({ cmd: cmd.command, plan: nextPlan.planNumber }, `Executing: ${cmd.command} ${cmd.args}`);
        result = await agent(cmd, config.workspaceRoot, agentLogger, {
          goalTitle: goal.title,
          phaseNumber: phaseNum,
          planNumber: nextPlan.planNumber,
        });
        if (!result.success) {
          sm.fail(result.error ?? 'Agent failed');
          try {
            await sendSms(`GSD goal failed.\nGoal: ${goal.title}\nError: ${result.error ?? 'Agent failed'}`);
          } catch (smsErr) {
            logger.warn({ err: smsErr }, 'SMS notification failed');
          }
          return;
        }
        await writeDaemonStateMd({
          stateMdPath,
          phaseNumber: phaseNum,
          totalPhases,
          phaseName: phase.name,
          planNumber: nextPlan.planNumber,
          totalPlans: plans.length,
          status: `Executed plan ${nextPlan.planNumber}`,
          lastActivity: new Date().toISOString(),
          gitSha: await getGitSha(config.workspaceRoot),
        });
        await reportProgress({
          stateMdPath,
          logger,
          onProgress,
          expectedPhase: phaseNum,
          expectedSummaryPath: nextPlan.summaryPath,
        });
        sm.setPlanInfo(nextPlan.planNumber + 1, plans.length);
        plans = await discoverPlans(phaseDir);
        nextPlan = getNextUnexecutedPlan(plans);
      }

      sm.advance(GoalLifecyclePhase.PhaseComplete);
      sm.setPhaseInfo(phaseNum + 1, totalPhases);

      for (let i = phaseNum; i < totalPhases; i++) {
        if (isShuttingDown()) {
          logShutdown(logger, sm);
          return;
        }
        const p = phases[i];
        const pNum = i + 1;
        sm.advance(GoalLifecyclePhase.PlanningPhase);
        const planCmd: GsdCommand = {
          command: '/gsd/plan-phase',
          args: String(p.number),
          description: `Plan phase ${p.number}`,
        };
        sm.setLastCommand(planCmd);
        result = await agent(planCmd, config.workspaceRoot, agentLogger, {
          goalTitle: goal.title,
          phaseNumber: pNum,
        });
        if (!result.success) {
          sm.fail(result.error ?? 'Agent failed');
          try {
            await sendSms(`GSD goal failed.\nGoal: ${goal.title}\nError: ${result.error ?? 'Agent failed'}`);
          } catch (smsErr) {
            logger.warn({ err: smsErr }, 'SMS notification failed');
          }
          return;
        }
        await writeDaemonStateMd({
          stateMdPath,
          phaseNumber: pNum,
          totalPhases,
          phaseName: p.name,
          planNumber: 0,
          totalPlans: 0,
          status: `Planned phase ${p.number}`,
          lastActivity: new Date().toISOString(),
          gitSha: await getGitSha(config.workspaceRoot),
        });
        await reportProgress({
          stateMdPath,
          logger,
          onProgress,
          expectedPhase: pNum,
        });
        const pDir = findPhaseDir(phasesRoot, p.number);
        if (!pDir) {
          sm.advance(GoalLifecyclePhase.PhaseComplete);
          sm.setPhaseInfo(pNum + 1, totalPhases);
          continue;
        }
        let pPlans = await discoverPlans(pDir);
        sm.setPlanInfo(1, pPlans.length);
        let pNext = getNextUnexecutedPlan(pPlans);
        while (pNext) {
          if (isShuttingDown()) {
            logShutdown(logger, sm);
            return;
          }
          await ensureCleanGitOrCheckpoint();
          await waitForCpuHeadroom();
          sm.advance(GoalLifecyclePhase.ExecutingPlan);
          const exec: GsdCommand = {
            command: '/gsd/execute-plan',
            args: pNext.planPath,
            description: `Execute plan ${pNext.planNumber}`,
          };
          sm.setLastCommand(exec);
          result = await agent(exec, config.workspaceRoot, agentLogger, {
            goalTitle: goal.title,
            phaseNumber: pNum,
            planNumber: pNext.planNumber,
          });
          if (!result.success) {
            sm.fail(result.error ?? 'Agent failed');
            try {
              await sendSms(`GSD goal failed.\nGoal: ${goal.title}\nError: ${result.error ?? 'Agent failed'}`);
            } catch (smsErr) {
              logger.warn({ err: smsErr }, 'SMS notification failed');
            }
            return;
          }
          await writeDaemonStateMd({
            stateMdPath,
            phaseNumber: pNum,
            totalPhases,
            phaseName: p.name,
            planNumber: pNext.planNumber,
            totalPlans: pPlans.length,
            status: `Executed plan ${pNext.planNumber}`,
            lastActivity: new Date().toISOString(),
            gitSha: await getGitSha(config.workspaceRoot),
          });
          await reportProgress({
            stateMdPath,
            logger,
            onProgress,
            expectedPhase: pNum,
            expectedSummaryPath: pNext.summaryPath,
          });
          sm.setPlanInfo(pNext.planNumber + 1, pPlans.length);
          pPlans = await discoverPlans(pDir);
          pNext = getNextUnexecutedPlan(pPlans);
        }
        sm.advance(GoalLifecyclePhase.PhaseComplete);
        sm.setPhaseInfo(pNum + 1, totalPhases);
      }

      sm.advance(GoalLifecyclePhase.Complete);
      logger.info({ goal: goal.title }, `Goal complete: ${goal.title}`);
      await writeDaemonStateMd({
        stateMdPath,
        phaseNumber: totalPhases,
        totalPhases,
        phaseName: phases[totalPhases - 1]?.name ?? 'Complete',
        planNumber: 0,
        totalPlans: 0,
        status: 'Complete',
        lastActivity: new Date().toISOString(),
        gitSha: await getGitSha(config.workspaceRoot),
      });
      try {
        await sendSms(`GSD goal complete.\nGoal: ${goal.title}`);
      } catch (smsErr) {
        logger.warn({ err: smsErr }, 'SMS notification failed');
      }
      return;
    }

    // Normal flow (no resume)
    if (isShuttingDown()) {
      logShutdown(logger, sm);
      return;
    }
    const initCmd = sm.getNextCommand()!;
    const projectMdPath = path.join(config.workspaceRoot, '.planning', 'PROJECT.md');
    const alreadyInitialized = await stat(projectMdPath)
      .then(() => true)
      .catch(() => false);
    if (!alreadyInitialized) {
      sm.setLastCommand(initCmd);
      logger.info({ cmd: initCmd.command }, `Executing: ${initCmd.command}`);
      result = await agent(initCmd, config.workspaceRoot, agentLogger, { goalTitle: goal.title });
      if (!result.success) {
        sm.fail(result.error ?? 'Agent failed');
        try {
          await sendSms(`GSD goal failed.\nGoal: ${goal.title}\nError: ${result.error ?? 'Agent failed'}`);
        } catch (smsErr) {
          logger.warn({ err: smsErr }, 'SMS notification failed');
        }
        return;
      }
    } else {
      logger.info(
        { projectMdPath },
        'Project already initialized — skipping /gsd/new-project',
      );
    }
    await writeDaemonStateMd({
      stateMdPath,
      phaseNumber: 0,
      totalPhases: 0,
      phaseName: 'Initializing project',
      planNumber: 0,
      totalPlans: 0,
      status: 'Initialized project',
      lastActivity: new Date().toISOString(),
      gitSha: await getGitSha(config.workspaceRoot),
    });
    await reportProgress({
      stateMdPath,
      logger,
      onProgress,
      expectedPhase: 0,
    });
    sm.advance(GoalLifecyclePhase.InitializingProject);

    // initializing_project → creating_roadmap
    if (isShuttingDown()) {
      logShutdown(logger, sm);
      return;
    }
    const roadmapCmd = sm.getNextCommand()!;
    const roadmapMdPath = path.join(config.workspaceRoot, '.planning', 'ROADMAP.md');
    const alreadyHasRoadmap = await stat(roadmapMdPath)
      .then(() => true)
      .catch(() => false);
    if (!alreadyHasRoadmap) {
      sm.setLastCommand(roadmapCmd);
      logger.info({ cmd: roadmapCmd.command }, `Executing: ${roadmapCmd.command}`);
      result = await agent(roadmapCmd, config.workspaceRoot, agentLogger, { goalTitle: goal.title });
      if (!result.success) {
        sm.fail(result.error ?? 'Agent failed');
        try {
          await sendSms(`GSD goal failed.\nGoal: ${goal.title}\nError: ${result.error ?? 'Agent failed'}`);
        } catch (smsErr) {
          logger.warn({ err: smsErr }, 'SMS notification failed');
        }
        return;
      }
    } else {
      logger.info(
        { roadmapMdPath },
        'Roadmap already exists — skipping /gsd/create-roadmap',
      );
    }
    await writeDaemonStateMd({
      stateMdPath,
      phaseNumber: 0,
      totalPhases: 0,
      phaseName: 'Creating roadmap',
      planNumber: 0,
      totalPlans: 0,
      status: 'Created roadmap',
      lastActivity: new Date().toISOString(),
      gitSha: await getGitSha(config.workspaceRoot),
    });
    await reportProgress({
      stateMdPath,
      logger,
      onProgress,
      expectedPhase: 0,
    });
    sm.advance(GoalLifecyclePhase.CreatingRoadmap);

    // creating_roadmap → phase loop
    const phases = await parseRoadmap(roadmapPath);
    const totalPhases = phases.length;
    sm.setPhaseInfo(1, totalPhases);
    logger.info({ totalPhases }, `Roadmap has ${totalPhases} phases`);

    for (let i = 0; i < totalPhases; i++) {
      const phase = phases[i];
      const phaseNum = i + 1;

      if (isShuttingDown()) {
        logShutdown(logger, sm);
        return;
      }

      sm.advance(GoalLifecyclePhase.PlanningPhase);

      const shouldSkipPlanning =
        typeof skipToPhase === 'number' && Number.isFinite(skipToPhase) && skipToPhase >= 2
          ? phaseNum < skipToPhase
          : false;

      if (shouldSkipPlanning) {
        logger.info(
          { phase: phase.number, phaseNum, skipToPhase },
          'Skipping /gsd/plan-phase due to skipToPhase hint',
        );
      } else {
        const planCmd: GsdCommand = {
          command: '/gsd/plan-phase',
          args: String(phase.number),
          description: `Plan phase ${phase.number}`,
        };
        sm.setLastCommand(planCmd);
        logger.info(
          { cmd: planCmd.command, phase: phase.number },
          `Executing: ${planCmd.command} ${planCmd.args}`,
        );
        result = await agent(planCmd, config.workspaceRoot, agentLogger, {
          goalTitle: goal.title,
          phaseNumber: phaseNum,
        });
        if (!result.success) {
          sm.fail(result.error ?? 'Agent failed');
          try {
            await sendSms(`GSD goal failed.\nGoal: ${goal.title}\nError: ${result.error ?? 'Agent failed'}`);
          } catch (smsErr) {
            logger.warn({ err: smsErr }, 'SMS notification failed');
          }
          return;
        }
        await writeDaemonStateMd({
          stateMdPath,
          phaseNumber: phaseNum,
          totalPhases,
          phaseName: phase.name,
          planNumber: 0,
          totalPlans: 0,
          status: `Planned phase ${phase.number}`,
          lastActivity: new Date().toISOString(),
          gitSha: await getGitSha(config.workspaceRoot),
        });
        await reportProgress({
          stateMdPath,
          logger,
          onProgress,
          expectedPhase: phaseNum,
        });
      }

      const phasesRoot = path.join(config.workspaceRoot, '.planning', 'phases');
      const phaseDir = findPhaseDir(phasesRoot, phase.number);
      if (!phaseDir) {
        logger.warn(
          { phase: phase.number },
          `Phase directory not found for phase ${phase.number} — skipping`,
        );
        sm.advance(GoalLifecyclePhase.PhaseComplete);
        logger.info({ phase: phase.number }, `Phase ${phase.number} complete (no directory)`);
        sm.setPhaseInfo(phaseNum + 1, totalPhases);
        continue;
      }

      let plans = await discoverPlans(phaseDir);
      sm.setPlanInfo(1, plans.length);
      logger.info(
        { phase: phase.number, planCount: plans.length },
        `Phase ${phase.number} has ${plans.length} plans`,
      );

      let nextPlan = getNextUnexecutedPlan(plans);

      if (!nextPlan) {
        logger.info(
          { phase: phase.number },
          `Phase ${phase.number} has no unexecuted plans — skipping to complete`,
        );
        sm.advance(GoalLifecyclePhase.PhaseComplete);
        logger.info({ phase: phase.number }, `Phase ${phase.number} complete`);
        sm.setPhaseInfo(phaseNum + 1, totalPhases);
        continue;
      }

      while (nextPlan) {
        if (isShuttingDown()) {
          logShutdown(logger, sm);
          return;
        }
        await ensureCleanGitOrCheckpoint();
        await waitForCpuHeadroom();
        sm.advance(GoalLifecyclePhase.ExecutingPlan);

        const execCmd: GsdCommand = {
          command: '/gsd/execute-plan',
          args: nextPlan.planPath,
          description: `Execute plan ${nextPlan.planNumber}`,
        };
        sm.setLastCommand(execCmd);
        logger.info(
          { cmd: execCmd.command, plan: nextPlan.planNumber },
          `Executing: ${execCmd.command} ${execCmd.args}`,
        );
        result = await agent(execCmd, config.workspaceRoot, agentLogger, {
          goalTitle: goal.title,
          phaseNumber: phaseNum,
          planNumber: nextPlan.planNumber,
        });
        if (!result.success) {
          sm.fail(result.error ?? 'Agent failed');
          try {
            await sendSms(`GSD goal failed.\nGoal: ${goal.title}\nError: ${result.error ?? 'Agent failed'}`);
          } catch (smsErr) {
            logger.warn({ err: smsErr }, 'SMS notification failed');
          }
          return;
        }
        await writeDaemonStateMd({
          stateMdPath,
          phaseNumber: phaseNum,
          totalPhases,
          phaseName: phase.name,
          planNumber: nextPlan.planNumber,
          totalPlans: plans.length,
          status: `Executed plan ${nextPlan.planNumber}`,
          lastActivity: new Date().toISOString(),
          gitSha: await getGitSha(config.workspaceRoot),
        });
        await reportProgress({
          stateMdPath,
          logger,
          onProgress,
          expectedPhase: phaseNum,
          expectedSummaryPath: nextPlan.summaryPath,
        });

        sm.setPlanInfo(nextPlan.planNumber + 1, plans.length);
        plans = await discoverPlans(phaseDir);
        nextPlan = getNextUnexecutedPlan(plans);
      }

      sm.advance(GoalLifecyclePhase.PhaseComplete);
      logger.info({ phase: phase.number }, `Phase ${phase.number} complete`);
      sm.setPhaseInfo(phaseNum + 1, totalPhases);
    }

    sm.advance(GoalLifecyclePhase.Complete);
    logger.info({ goal: goal.title }, `Goal complete: ${goal.title}`);
    await writeDaemonStateMd({
      stateMdPath,
      phaseNumber: totalPhases,
      totalPhases,
      phaseName: phases[totalPhases - 1]?.name ?? 'Complete',
      planNumber: 0,
      totalPlans: 0,
      status: 'Complete',
      lastActivity: new Date().toISOString(),
      gitSha: await getGitSha(config.workspaceRoot),
    });
    try {
      await sendSms(`GSD goal complete.\nGoal: ${goal.title}`);
    } catch (smsErr) {
      logger.warn({ err: smsErr }, 'SMS notification failed');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sm.fail(message);
    logger.error({ err, goal: goal.title }, `Orchestration failed for goal: ${goal.title}`);
    try {
      await sendSms(`GSD goal failed.\nGoal: ${goal.title}\nError: ${message}`);
    } catch (smsErr) {
      logger.warn({ err: smsErr }, 'SMS notification failed');
    }
    throw err;
  }
}

function logShutdown(logger: Logger, sm: GoalStateMachine): void {
  const progress = sm.getProgress();
  logger.info(
    { progress },
    `Shutdown requested — stopping orchestration after current step at phase ${progress.currentPhaseNumber}, plan ${progress.currentPlanIndex}`,
  );
}
