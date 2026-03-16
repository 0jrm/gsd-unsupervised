import path from 'node:path';
import type { AutopilotConfig } from './config.js';
import type { Logger } from './logger.js';
import type { Goal } from './goals.js';
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

export interface AgentResult {
  success: boolean;
  output?: string;
  error?: string;
}

export type AgentInvoker = (
  command: GsdCommand,
  workspaceDir: string,
  logger: Logger,
) => Promise<AgentResult>;

const stubAgent: AgentInvoker = async (command, workspaceDir, logger) => {
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
}): Promise<void> {
  const { goal, config, isShuttingDown } = options;
  const logger = createChildLogger(options.logger, 'orchestrator');
  const agent = options.agent ?? stubAgent;
  const sm = new GoalStateMachine(goal.title);

  try {
    // new → initializing_project
    if (isShuttingDown()) {
      logShutdown(logger, sm);
      return;
    }
    const initCmd = sm.getNextCommand()!;
    sm.setLastCommand(initCmd);
    logger.info({ cmd: initCmd.command }, `Executing: ${initCmd.command}`);
    let result = await agent(initCmd, config.workspaceRoot, logger);
    if (!result.success) {
      sm.fail(result.error ?? 'Agent failed');
      return;
    }
    sm.advance(GoalLifecyclePhase.InitializingProject);

    // initializing_project → creating_roadmap
    if (isShuttingDown()) {
      logShutdown(logger, sm);
      return;
    }
    const roadmapCmd = sm.getNextCommand()!;
    sm.setLastCommand(roadmapCmd);
    logger.info({ cmd: roadmapCmd.command }, `Executing: ${roadmapCmd.command}`);
    result = await agent(roadmapCmd, config.workspaceRoot, logger);
    if (!result.success) {
      sm.fail(result.error ?? 'Agent failed');
      return;
    }
    sm.advance(GoalLifecyclePhase.CreatingRoadmap);

    // creating_roadmap → phase loop
    const roadmapPath = path.join(config.workspaceRoot, '.planning', 'ROADMAP.md');
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
      result = await agent(planCmd, config.workspaceRoot, logger);
      if (!result.success) {
        sm.fail(result.error ?? 'Agent failed');
        return;
      }

      const phasesRoot = path.join(config.workspaceRoot, '.planning', 'phases');
      const phaseDir = findPhaseDir(phasesRoot, phase.number);
      if (!phaseDir) {
        sm.fail(`Phase directory not found for phase ${phase.number}`);
        return;
      }

      let plans = await discoverPlans(phaseDir);
      sm.setPlanInfo(1, plans.length);
      logger.info(
        { phase: phase.number, planCount: plans.length },
        `Phase ${phase.number} has ${plans.length} plans`,
      );

      let nextPlan = getNextUnexecutedPlan(plans);
      while (nextPlan) {
        if (isShuttingDown()) {
          logShutdown(logger, sm);
          return;
        }

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
        result = await agent(execCmd, config.workspaceRoot, logger);
        if (!result.success) {
          sm.fail(result.error ?? 'Agent failed');
          return;
        }

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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sm.fail(message);
    logger.error({ err, goal: goal.title }, `Orchestration failed for goal: ${goal.title}`);
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
