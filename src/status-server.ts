import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface StatusPayload {
  running: boolean;
  currentGoal?: string;
  phaseNumber?: number;
  planNumber?: number;
  heartbeat?: string;
}

/**
 * Creates a minimal HTTP server that serves GET / and GET /status with JSON status.
 * No new dependencies; uses node:http only. For dashboard/phone consumers.
 */
export function createStatusServer(
  port: number,
  getStatus: () => StatusPayload,
): { server: ReturnType<typeof createServer>; close: () => Promise<void> } {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';
    if (req.method !== 'GET' || (url !== '/' && url !== '/status')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const payload = getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });

  server.listen(port);

  const close = (): Promise<void> =>
    new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

  return { server, close };
}
