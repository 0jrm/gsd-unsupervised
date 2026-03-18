import type { ComplexityScore, RawGoal } from './types.js';
import { runAgent } from '../agent-runner.js';

export const DEFAULT_CLASSIFIER_MODEL = 'cursor' as const;

export interface ClassifierAgentConfig {
  agentPath?: string;
  model?: string;
  timeoutMs?: number;
}

function wordCount(s: string): number {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function extractFilenames(title: string): string[] {
  // Capture simple file-like tokens (e.g. auth.ts, style.css, README.md)
  const re = /\b[\w./-]+?\.(ts|js|css|md)\b/gi;
  return title.match(re) ?? [];
}

function includesAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

export async function classifyGoal(
  raw: RawGoal,
  agentConfig?: ClassifierAgentConfig,
): Promise<ComplexityScore> {
  const title = raw.title;
  const body = raw.body ?? '';
  const allText = `${title}\n${body}`.trim();
  const titleWords = wordCount(title);
  const bodyWords = raw.body ? wordCount(raw.body) : 0;

  // Score 5: explicit large-scope keywords
  if (
    includesAny(title, [
      'new project',
      'from scratch',
      'full rewrite',
      'architecture',
      'redesign entire',
    ])
  ) {
    return {
      score: 5,
      reasoning: 'large project scope',
      suggestedQuestions: [],
    };
  }

  // Score 4: refactor/multi-system change keywords
  if (includesAny(title, ['refactor', 'redesign', 'multiple systems', 'integrate'])) {
    return {
      score: 4,
      reasoning: 'multi-system refactor scope',
      suggestedQuestions: [],
    };
  }

  // Score 2: a single filename reference and short enough
  const filenames = extractFilenames(title);
  if (filenames.length === 1 && titleWords < 30) {
    return {
      score: 2,
      reasoning: 'single file change scope',
      suggestedQuestions: [],
    };
  }

  // Score 1: short with no scope keywords
  const hasScopeKeywords = includesAny(title, [
    'refactor',
    'redesign',
    'integrate',
    'multiple systems',
    'new project',
    'from scratch',
    'full rewrite',
    'architecture',
    'redesign entire',
  ]);

  const bodyWordOk = raw.body == null ? true : bodyWords < 15;
  const noScope = !hasScopeKeywords && filenames.length === 0;
  // "Tiny fix" heuristic: require a very short title (prevents ambiguous feature requests
  // like "add dark mode to dashboard" from being misclassified as score 1).
  if (bodyWordOk && noScope && titleWords <= 4) {
    return {
      score: 1,
      reasoning: 'tiny fix scope',
      suggestedQuestions: [],
    };
  }

  // Score 3: ambiguous/moderate feature -> use cursor-agent
  const goalTitle = title;
  const prompt = `Considering the current project, what do we need to seamlessly and efficiently implement ${goalTitle}?

Respond with JSON only, no prose:
{
  "score": <1-5 integer>,
  "reasoning": "<one sentence>",
  "suggestedQuestions": ["<question if score >= 3>"]
}

Score guide: 1=tiny fix, 2=single file change, 3=moderate feature, 4=multi-system change, 5=large project.`;

  const result = (await runAgent({
    agentPath: agentConfig?.agentPath ?? 'cursor-agent',
    workspace: raw.projectPath,
    prompt,
    timeoutMs: agentConfig?.timeoutMs,
    model: agentConfig?.model ?? DEFAULT_CLASSIFIER_MODEL,
  } as any)) as any;

  const success = typeof result?.success === 'boolean' ? result.success : Boolean(result?.output);
  const output: unknown = result?.output ?? result?.resultEvent?.result;

  if (!success || typeof output !== 'string') {
    return { score: 3, reasoning: 'classifier unavailable', suggestedQuestions: [] };
  }

  try {
    const parsed = JSON.parse(output) as Partial<ComplexityScore> & { score?: number };
    const scoreNum = parsed.score;
    const score = scoreNum as ComplexityScore['score'];
    if (![1, 2, 3, 4, 5].includes(scoreNum as number)) {
      return { score: 3, reasoning: 'classifier unavailable', suggestedQuestions: [] };
    }
    return {
      score,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      suggestedQuestions: Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions : [],
    };
  } catch {
    return { score: 3, reasoning: 'classifier unavailable', suggestedQuestions: [] };
  }
}

