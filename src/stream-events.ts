import { z } from 'zod';

// --- Zod Schemas ---

const SystemInitEventSchema = z
  .object({
    type: z.literal('system'),
    subtype: z.literal('init'),
    session_id: z.string(),
    model: z.string(),
    cwd: z.string(),
    apiKeySource: z.string(),
    permissionMode: z.string(),
  })
  .passthrough();

const ContentBlockSchema = z
  .object({
    type: z.string(),
    text: z.string(),
  })
  .passthrough();

const MessageSchema = z
  .object({
    role: z.string(),
    content: z.array(ContentBlockSchema),
  })
  .passthrough();

const AssistantEventSchema = z
  .object({
    type: z.literal('assistant'),
    message: MessageSchema,
    session_id: z.string(),
  })
  .passthrough();

const ToolCallEventSchema = z
  .object({
    type: z.literal('tool_call'),
    subtype: z.string(),
    call_id: z.string(),
    tool_call: z.object({ name: z.string() }).passthrough(),
    session_id: z.string(),
  })
  .passthrough();

const ResultEventSchema = z
  .object({
    type: z.literal('result'),
    subtype: z.string(),
    duration_ms: z.number(),
    duration_api_ms: z.number(),
    is_error: z.boolean(),
    result: z.string(),
    session_id: z.string(),
  })
  .passthrough();

const CursorStreamEventSchema = z.discriminatedUnion('type', [
  SystemInitEventSchema,
  AssistantEventSchema,
  ToolCallEventSchema,
  ResultEventSchema,
]);

// --- TypeScript Types ---

export type SystemInitEvent = z.infer<typeof SystemInitEventSchema>;
export type AssistantEvent = z.infer<typeof AssistantEventSchema>;
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;
export type ResultEvent = z.infer<typeof ResultEventSchema>;
export type CursorStreamEvent = z.infer<typeof CursorStreamEventSchema>;

// --- Functions ---

export function parseEvent(line: string): CursorStreamEvent | null {
  if (!line) return null;

  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return null;
  }

  const result = CursorStreamEventSchema.safeParse(json);
  if (!result.success) return null;

  return result.data;
}

export function extractSessionId(events: CursorStreamEvent[]): string | null {
  const init = events.find(
    (e): e is SystemInitEvent => e.type === 'system' && e.subtype === 'init',
  );
  return init?.session_id ?? null;
}

export function extractResult(events: CursorStreamEvent[]): ResultEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type === 'result') {
      return e as ResultEvent;
    }
  }

  return null;
}
