import { describe, it, expect } from 'vitest';
import {
  parseEvent,
  extractSessionId,
  extractResult,
  type CursorStreamEvent,
  type SystemInitEvent,
  type AssistantEvent,
  type ToolCallEvent,
  type ResultEvent,
} from './stream-events.js';

describe('parseEvent', () => {
  describe('SystemInitEvent', () => {
    it('parses a valid system init event', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'abc',
        model: 'claude-4',
        cwd: '/tmp',
        apiKeySource: 'env',
        permissionMode: 'auto',
      });

      const event = parseEvent(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe('system');

      const sys = event as SystemInitEvent;
      expect(sys.subtype).toBe('init');
      expect(sys.session_id).toBe('abc');
      expect(sys.model).toBe('claude-4');
      expect(sys.cwd).toBe('/tmp');
      expect(sys.apiKeySource).toBe('env');
      expect(sys.permissionMode).toBe('auto');
    });
  });

  describe('AssistantEvent', () => {
    it('parses a valid assistant event', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
        },
        session_id: 'abc',
      });

      const event = parseEvent(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe('assistant');

      const asst = event as AssistantEvent;
      expect(asst.session_id).toBe('abc');
      expect(asst.message.role).toBe('assistant');
      expect(asst.message.content).toHaveLength(1);
      expect(asst.message.content[0].type).toBe('text');
      expect(asst.message.content[0].text).toBe('hello');
    });
  });

  describe('ToolCallEvent', () => {
    it('parses a tool_call started event', () => {
      const line = JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'c1',
        tool_call: { name: 'Shell' },
        session_id: 'abc',
      });

      const event = parseEvent(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe('tool_call');

      const tc = event as ToolCallEvent;
      expect(tc.subtype).toBe('started');
      expect(tc.call_id).toBe('c1');
      expect(tc.tool_call.name).toBe('Shell');
      expect(tc.session_id).toBe('abc');
    });

    it('parses a tool_call completed event', () => {
      const line = JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'c1',
        tool_call: { name: 'Shell' },
        session_id: 'abc',
      });

      const event = parseEvent(line);
      expect(event).not.toBeNull();

      const tc = event as ToolCallEvent;
      expect(tc.subtype).toBe('completed');
      expect(tc.call_id).toBe('c1');
    });
  });

  describe('ResultEvent', () => {
    it('parses a valid result event', () => {
      const line = JSON.stringify({
        type: 'result',
        subtype: 'success',
        duration_ms: 5000,
        duration_api_ms: 4500,
        is_error: false,
        result: 'done',
        session_id: 'abc',
      });

      const event = parseEvent(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe('result');

      const res = event as ResultEvent;
      expect(res.subtype).toBe('success');
      expect(res.duration_ms).toBe(5000);
      expect(res.duration_api_ms).toBe(4500);
      expect(res.is_error).toBe(false);
      expect(res.result).toBe('done');
      expect(res.session_id).toBe('abc');
    });
  });

  describe('edge cases', () => {
    it('returns null for malformed JSON', () => {
      expect(parseEvent('not json at all {')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseEvent('')).toBeNull();
    });

    it('returns null for unknown event type', () => {
      const line = JSON.stringify({
        type: 'unknown_type',
        session_id: 'abc',
      });
      expect(parseEvent(line)).toBeNull();
    });

    it('passes through extra unknown fields', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'abc',
        model: 'claude-4',
        cwd: '/tmp',
        apiKeySource: 'env',
        permissionMode: 'auto',
        extraField: 'should not break',
        anotherExtra: 42,
      });

      const event = parseEvent(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe('system');
      const raw = event as Record<string, unknown>;
      expect(raw['extraField']).toBe('should not break');
      expect(raw['anotherExtra']).toBe(42);
    });
  });
});

describe('extractSessionId', () => {
  it('returns session_id from first SystemInitEvent', () => {
    const events: CursorStreamEvent[] = [
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-123',
        model: 'claude-4',
        cwd: '/tmp',
        apiKeySource: 'env',
        permissionMode: 'auto',
      } as SystemInitEvent,
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        session_id: 'sess-123',
      } as AssistantEvent,
    ];

    expect(extractSessionId(events)).toBe('sess-123');
  });

  it('returns null when no SystemInitEvent exists', () => {
    const events: CursorStreamEvent[] = [
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        session_id: 'abc',
      } as AssistantEvent,
    ];

    expect(extractSessionId(events)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(extractSessionId([])).toBeNull();
  });
});

describe('extractResult', () => {
  it('returns the ResultEvent from events', () => {
    const resultEvent: ResultEvent = {
      type: 'result',
      subtype: 'success',
      duration_ms: 5000,
      duration_api_ms: 4500,
      is_error: false,
      result: 'done',
      session_id: 'abc',
    };

    const events: CursorStreamEvent[] = [
      {
        type: 'system',
        subtype: 'init',
        session_id: 'abc',
        model: 'claude-4',
        cwd: '/tmp',
        apiKeySource: 'env',
        permissionMode: 'auto',
      } as SystemInitEvent,
      resultEvent,
    ];

    expect(extractResult(events)).toEqual(resultEvent);
  });

  it('returns the last ResultEvent when multiple exist', () => {
    const first: ResultEvent = {
      type: 'result',
      subtype: 'success',
      duration_ms: 1000,
      duration_api_ms: 900,
      is_error: false,
      result: 'first',
      session_id: 'sess-1',
    };

    const last: ResultEvent = {
      type: 'result',
      subtype: 'success',
      duration_ms: 2000,
      duration_api_ms: 1800,
      is_error: false,
      result: 'last',
      session_id: 'sess-1',
    };

    const events: CursorStreamEvent[] = [
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
        model: 'claude-4',
        cwd: '/tmp',
        apiKeySource: 'env',
        permissionMode: 'auto',
      } as SystemInitEvent,
      first,
      last,
    ];

    expect(extractResult(events)).toEqual(last);
  });

  it('prefers the last ResultEvent even when it represents an error', () => {
    const success: ResultEvent = {
      type: 'result',
      subtype: 'success',
      duration_ms: 1000,
      duration_api_ms: 900,
      is_error: false,
      result: 'ok',
      session_id: 'sess-1',
    };

    const error: ResultEvent = {
      type: 'result',
      subtype: 'error',
      duration_ms: 1500,
      duration_api_ms: 1400,
      is_error: true,
      result: 'boom',
      session_id: 'sess-1',
    };

    const events: CursorStreamEvent[] = [success, error];

    const result = extractResult(events);
    expect(result).toEqual(error);
    expect(result!.is_error).toBe(true);
    expect(result!.result).toBe('boom');
  });

  it('returns null when no ResultEvent exists', () => {
    const events: CursorStreamEvent[] = [
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        session_id: 'abc',
      } as AssistantEvent,
    ];

    expect(extractResult(events)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(extractResult([])).toBeNull();
  });
});
