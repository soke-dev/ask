import type { Server } from 'node:http';
import pg from 'pg';
import { WebSocketServer, WebSocket } from 'ws';
import { config, hasDatabase } from './config.js';

/**
 * Realtime, from Postgres to the phone.
 *
 *   trigger → pg_notify('changes') → this LISTEN client → WebSocket → app
 *
 * WebSocket rather than Server-Sent Events specifically because of React
 * Native: RN ships a WebSocket implementation, but has no EventSource and no
 * streaming fetch, so SSE would need a polyfill on the one platform that
 * matters most here.
 */

export type ChangeEvent = {
  table: string;
  op: 'insert' | 'update' | 'delete';
  id: string;
  topic: string;
  at: number;
};

type Client = {
  socket: WebSocket;
  topics: Set<string>;
  /** Cleared by every pong; a client that misses two rounds is dropped. */
  missedBeats: number;
};

const clients = new Set<Client>();
let listener: pg.Client | null = null;
let reconnectDelay = 1000;

/**
 * Holds one dedicated connection open for LISTEN.
 *
 * It cannot come from the pool: a pooled connection is handed back after each
 * query and could be given to someone else, or closed entirely, silently
 * ending the subscription. Nothing would error — notifications would just stop
 * arriving, which is the hardest kind of failure to notice.
 */
async function startListening(): Promise<void> {
  if (!hasDatabase()) {
    console.log('  realtime: DATABASE_URL unset — no change stream');
    return;
  }

  const client = new pg.Client({
    connectionString: config.databaseUrl,
    ssl: config.databaseUrl.includes('localhost') ? undefined : { rejectUnauthorized: false },
  });

  client.on('notification', (message) => {
    if (message.channel !== 'changes' || !message.payload) return;
    try {
      broadcast(JSON.parse(message.payload) as ChangeEvent);
    } catch {
      // A malformed payload is not worth killing the listener over.
    }
  });

  // A dropped database connection must not silently end realtime for everyone.
  client.on('error', (error) => {
    console.error('realtime: listener lost —', error.message);
    listener = null;
    client.end().catch(() => {});
    scheduleReconnect();
  });

  try {
    await client.connect();
    await client.query('LISTEN changes');
    listener = client;
    reconnectDelay = 1000;
    console.log('  realtime: listening on the "changes" channel');
  } catch (error) {
    console.error(
      'realtime: could not start listening —',
      error instanceof Error ? error.message : error,
    );
    scheduleReconnect();
  }
}

/** Exponential backoff to 30s, so an outage does not become a retry storm. */
function scheduleReconnect(): void {
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  setTimeout(() => {
    void startListening();
  }, delay).unref();
}

function broadcast(event: ChangeEvent): void {
  const message = JSON.stringify({ type: 'change', ...event });
  for (const client of clients) {
    if (!client.topics.has(event.topic)) continue;
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    client.socket.send(message);
  }
}

/**
 * Attaches the WebSocket endpoint to the HTTP server.
 *
 * Clients send `{"subscribe":["question:<id>","user:<id>"]}` and receive
 * `{"type":"change", table, op, id, topic}` — identifiers only. The client
 * re-fetches what it needs, which keeps authorisation on the API side rather
 * than pushing row contents to whoever happens to be listening.
 */
export function attachRealtime(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/realtime' });

  wss.on('connection', (socket) => {
    const client: Client = { socket, topics: new Set(), missedBeats: 0 };
    clients.add(client);

    socket.on('pong', () => {
      client.missedBeats = 0;
    });

    socket.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as {
          subscribe?: unknown;
          unsubscribe?: unknown;
        };
        if (Array.isArray(parsed.subscribe)) {
          for (const topic of parsed.subscribe) {
            if (typeof topic === 'string' && topic.length < 200) client.topics.add(topic);
          }
        }
        if (Array.isArray(parsed.unsubscribe)) {
          for (const topic of parsed.unsubscribe) {
            if (typeof topic === 'string') client.topics.delete(topic);
          }
        }
        socket.send(JSON.stringify({ type: 'subscribed', topics: [...client.topics] }));
      } catch {
        socket.send(JSON.stringify({ type: 'error', detail: 'Expected JSON.' }));
      }
    });

    const close = () => clients.delete(client);
    socket.on('close', close);
    socket.on('error', close);

    socket.send(JSON.stringify({ type: 'ready', listening: listener !== null }));
  });

  /**
   * Mobile connections die without closing — a phone loses signal, goes into
   * a tunnel, or the OS suspends the app, and the socket stays "open" on this
   * end forever. Without a heartbeat those accumulate and every broadcast
   * writes into dead sockets.
   */
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.missedBeats >= 2) {
        client.socket.terminate();
        clients.delete(client);
        continue;
      }
      client.missedBeats += 1;
      if (client.socket.readyState === WebSocket.OPEN) client.socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  wss.on('close', () => clearInterval(heartbeat));

  void startListening();
}

/** For the health endpoint. */
export const realtimeStatus = () => ({
  listening: listener !== null,
  clients: clients.size,
});
