import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Creates a todo file under .planning/todos/pending/ (GSD add-todo format).
 * Used by webhook and external add-todo flows.
 */
export async function addTodo(
  workspaceRoot: string,
  title: string,
  area: string = 'general',
): Promise<string> {
  const pendingDir = path.join(workspaceRoot, '.planning', 'todos', 'pending');
  await mkdir(pendingDir, { recursive: true });
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const datePrefix = new Date().toISOString().slice(0, 10);
  const created = new Date().toISOString().slice(0, 16).replace('T', 'T');
  const filename = `${datePrefix}-${slug || 'todo'}.md`;
  const filePath = path.join(pendingDir, filename);
  const body = `---
created: ${created}
title: ${title}
area: ${area}
files: []
---

## Problem

Added via webhook or API. No additional context.

## Solution

TBD
`;
  await writeFile(filePath, body, 'utf-8');
  return filePath;
}
