import { AppState, type AppStateStatus } from 'react-native';
import { realtimeUrl } from './api';

/**
 * One WebSocket for the whole app.
 *
 * Screens come and go — the tracking screen, the earn tab, the disputes list —
 * and each wants to hear about different things. Giving every screen its own
 * socket would open and close connections on each navigation and hold several
 * at once. Instead there is a single connection, and screens register topics
 * against it.
 */

export type ChangeEvent = {
  table: string;
  op: 'insert' | 'update' | 'delete';
  id: string;
  topic: string;
  at: number;
};

export type RealtimeStatus = 'disabled' | 'connecting' | 'open' | 'offline';

type Listener = (event: ChangeEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const statusWatchers = new Set<(status: RealtimeStatus) => void>();

let socket: WebSocket | null = null;
let status: RealtimeStatus = realtimeUrl() ? 'offline' : 'disabled';
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove: () => void } | null = null;

function setStatus(next: RealtimeStatus): void {
  if (status === next) return;
  status = next;
  for (const watch of statusWatchers) watch(next);
}

export const getStatus = (): RealtimeStatus => status;

export function watchStatus(fn: (status: RealtimeStatus) => void): () => void {
  statusWatchers.add(fn);
  fn(status);
  return () => statusWatchers.delete(fn);
}

/**
 * Backoff with jitter.
 *
 * Without the random component every client that dropped during the same
 * outage would reconnect at the same instant and knock the server over again
 * the moment it recovered. The jitter spreads that crowd out.
 */
function retryDelay(): number {
  const base = Math.min(1000 * 2 ** attempt, 30_000);
  return base * (0.7 + Math.random() * 0.6);
}

function connect(): void {
  const url = realtimeUrl();
  if (!url || socket) return;

  setStatus('connecting');
  const ws = new WebSocket(url);
  socket = ws;

  ws.onopen = () => {
    attempt = 0;
    setStatus('open');
    resubscribe();
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as { type?: string } & ChangeEvent;
      if (message.type !== 'change') return;
      for (const fn of listeners.get(message.topic) ?? []) fn(message);
    } catch {
      // Nothing useful to do with a malformed frame.
    }
  };

  const drop = () => {
    if (socket !== ws) return;
    socket = null;
    setStatus('offline');
    scheduleRetry();
  };

  ws.onerror = drop;
  ws.onclose = drop;
}

function scheduleRetry(): void {
  if (retryTimer || listeners.size === 0) return;
  const delay = retryDelay();
  attempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, delay);
}

/**
 * Re-sends every topic after a reconnect.
 *
 * Subscriptions live on the server side of the socket, so a new socket knows
 * nothing about them. Without this the app would reconnect successfully and
 * then sit in silence — the worst kind of failure, because it looks fine.
 */
function resubscribe(): void {
  if (!socket || socket.readyState !== 1 || listeners.size === 0) return;
  socket.send(JSON.stringify({ subscribe: [...listeners.keys()] }));
}

/**
 * Listens to one topic. Returns the unsubscribe function.
 *
 * Topics look like `question:<id>` or `user:<id>` and are produced by the
 * database triggers, so the client never has to guess where a change will
 * arrive.
 */
export function subscribe(topic: string, fn: Listener): () => void {
  const existing = listeners.get(topic);
  if (existing) {
    existing.add(fn);
  } else {
    listeners.set(topic, new Set([fn]));
    if (socket?.readyState === 1) {
      socket.send(JSON.stringify({ subscribe: [topic] }));
    }
  }

  connect();
  watchAppState();

  return () => {
    const set = listeners.get(topic);
    if (!set) return;
    set.delete(fn);
    if (set.size > 0) return;

    listeners.delete(topic);
    if (socket?.readyState === 1) {
      socket.send(JSON.stringify({ unsubscribe: [topic] }));
    }
    // Nothing left to listen for — stop reconnecting and let the socket go.
    if (listeners.size === 0) {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      socket?.close();
      socket = null;
      appStateSub?.remove();
      appStateSub = null;
      setStatus(realtimeUrl() ? 'offline' : 'disabled');
    }
  };
}

/**
 * Reconnects when the app comes back to the foreground.
 *
 * iOS and Android suspend a backgrounded app's sockets without delivering a
 * close event. The connection is dead but this side still believes it is open,
 * so no retry is ever scheduled and the user returns to a screen that quietly
 * stopped updating. Coming back to the foreground is the cue to check.
 */
function watchAppState(): void {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next !== 'active' || listeners.size === 0) return;
    if (socket && socket.readyState === 1) {
      resubscribe();
      return;
    }
    socket = null;
    attempt = 0;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    connect();
  });
}
