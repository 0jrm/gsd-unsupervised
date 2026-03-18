import { readFile } from 'node:fs/promises';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const REQUIRED_SECTIONS = [
  ['<objective>', '</objective>'],
  ['<tasks>', '</tasks>'],
  ['<verification>', '</verification>'],
  ['<success_criteria>', '</success_criteria>'],
] as const;

function extractSection(content: string, openTag: string, closeTag: string): string {
  const openIdx = content.indexOf(openTag);
  if (openIdx < 0) return '';
  const start = openIdx + openTag.length;
  const closeIdx = content.indexOf(closeTag, start);
  if (closeIdx < 0) return '';
  return content.slice(start, closeIdx).trim();
}

/**
 * Validates a PLAN.md file has required sections and at least one task.
 * Returns { valid: true } or { valid: false, errors: [...] }.
 */
export async function validatePlanFile(planPath: string): Promise<ValidationResult> {
  const errors: string[] = [];

  let content: string;
  try {
    content = await readFile(planPath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [`File unreadable: ${msg}`] };
  }

  if (!content || content.trim().length === 0) {
    return { valid: false, errors: ['Plan file is empty'] };
  }

  for (const [openTag, closeTag] of REQUIRED_SECTIONS) {
    const section = extractSection(content, openTag, closeTag);
    if (!section) {
      errors.push(`Missing or empty required section: ${openTag}...${closeTag}`);
    }
  }

  const tasksSection = extractSection(content, '<tasks>', '</tasks>');
  if (tasksSection && !/<task[\s>]/i.test(tasksSection)) {
    errors.push('Section <tasks> must contain at least one <task> element');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
