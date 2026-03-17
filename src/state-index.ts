import type { Logger } from './logger.js';
import type { StateSnapshot } from './state-types.js';
import { parseStateMd, readStateMd } from './state-parser.js';

export type { StateSnapshot } from './state-types.js';

export function parseStateFile(contents: string, logger?: Logger): StateSnapshot | null {
  try {
    const snapshot = parseStateMd(contents);
    if (!snapshot && logger) {
      logger.warn({ reason: 'unparseable_state_md' }, 'Failed to parse STATE.md contents');
    }
    return snapshot;
  } catch (err) {
    if (logger) {
      logger.warn({ err }, 'Exception while parsing STATE.md contents');
    }
    return null;
  }
}

export async function readStateFile(
  filePath: string,
  logger?: Logger,
): Promise<StateSnapshot | null> {
  try {
    const snapshot = await readStateMd(filePath);
    if (!snapshot && logger) {
      logger.warn({ path: filePath, reason: 'unparseable_or_missing' }, 'Failed to read STATE.md');
    }
    return snapshot;
  } catch (err) {
    if (logger) {
      logger.warn({ err, path: filePath }, 'Exception while reading STATE.md');
    }
    return null;
  }
}

