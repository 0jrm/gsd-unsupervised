export type GoalRoute = 'quick' | 'full';

export interface GoalBreadcrumbMetadata {
  route?: GoalRoute;
  contextBundlePath?: string;
  sessionContextPath?: string;
  agentBriefPath?: string;
}

export interface GoalMetadata extends GoalBreadcrumbMetadata {
  goal?: string;
  successCriteria?: string[];
}

function extractField(block: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(
    new RegExp(`\\*\\*${escaped}:\\*\\*\\s*(.+?)(?=\\n\\s*\\*\\*|\\n\\s*\\d+\\.|\\n\\s*-\\s|\\n\\n|$)`, 'is'),
  );
  return match ? match[1].trim() : undefined;
}

function extractSuccessCriteria(block: string): string[] {
  const criteria: string[] = [];
  const listMatch = block.match(/\*\*Success criteria:\*\*\s*([\s\S]*?)(?=\n\s*\*\*|\n\n|$)/is);
  const list = listMatch?.[1]?.trim();
  if (!list) return criteria;

  for (const line of list.split('\n')) {
    const match = line.match(/^\s*(?:\d+\.|\-)\s+(.+)$/);
    if (match) criteria.push(match[1].trim());
  }

  return criteria;
}

export function parseGoalMetadataBlock(block: string): GoalMetadata {
  const goal = extractField(block, 'Goal');
  const routeValue = extractField(block, 'Route');
  const route = routeValue === 'quick' || routeValue === 'full' ? routeValue : undefined;
  const contextBundlePath = extractField(block, 'Context bundle');
  const sessionContextPath = extractField(block, 'Session context');
  const agentBriefPath = extractField(block, 'Agent brief');
  const successCriteria = extractSuccessCriteria(block);

  return {
    ...(goal ? { goal } : {}),
    ...(successCriteria.length > 0 ? { successCriteria } : {}),
    ...(route ? { route } : {}),
    ...(contextBundlePath ? { contextBundlePath } : {}),
    ...(sessionContextPath ? { sessionContextPath } : {}),
    ...(agentBriefPath ? { agentBriefPath } : {}),
  };
}

export function buildGoalMetadataBlock(
  title: string,
  metadata: GoalMetadata,
): string | undefined {
  const lines: string[] = [`### ${title}`];
  const goal = metadata.goal?.trim();
  const route = metadata.route?.trim();
  const contextBundlePath = metadata.contextBundlePath?.trim();
  const sessionContextPath = metadata.sessionContextPath?.trim();
  const agentBriefPath = metadata.agentBriefPath?.trim();
  const successCriteria = metadata.successCriteria?.map((item) => item.trim()).filter(Boolean) ?? [];

  const hasStructuredFields =
    Boolean(goal) ||
    Boolean(route) ||
    Boolean(contextBundlePath) ||
    Boolean(sessionContextPath) ||
    Boolean(agentBriefPath);

  if (!hasStructuredFields) {
    return undefined;
  }

  if (goal) lines.push(`**Goal:** ${goal}`);

  if (successCriteria.length > 0) {
    lines.push('**Success criteria:**');
    for (const item of successCriteria) {
      lines.push(`1. ${item}`);
    }
  }

  if (route) lines.push(`**Route:** ${route}`);
  if (contextBundlePath) lines.push(`**Context bundle:** ${contextBundlePath}`);
  if (sessionContextPath) lines.push(`**Session context:** ${sessionContextPath}`);
  if (agentBriefPath) lines.push(`**Agent brief:** ${agentBriefPath}`);

  return lines.join('\n');
}
