import type { Request } from 'express';
import { config } from './config.js';

/**
 * Where the pages think they are.
 *
 * Every page this server renders writes absolute links back to itself, so it
 * has to know its own address. Asking the request was wrong twice over.
 *
 * The scheme was wrong: Railway terminates TLS and forwards plain HTTP, so
 * req.protocol was "http" and every link on the live landing page pointed at
 * an insecure scheme. The host is wrong the moment anything sits in front of
 * this — a CDN, a proxy, a custom domain — because the request arrives
 * addressed to the origin server, and a page served at confam.xyz would send
 * every reader to the Railway hostname instead.
 *
 * So: PUBLIC_ORIGIN wins when it is set, and it should be set in production.
 * That also closes the hole in the fallback, which trusts x-forwarded-host —
 * a header the client controls, and therefore a way to make this server write
 * somebody else's domain into a page. The fallback is for development, where
 * there is no proxy and no attacker worth the name.
 */
export function originOf(req: Request): string {
  if (config.publicOrigin) return config.publicOrigin;

  // A forwarded header can carry a list; the first entry is the client's.
  const first = (value: string | undefined) => ((value ?? '').split(',')[0] ?? '').trim();

  const host = first(req.get('x-forwarded-host')) || req.get('host') || '';
  const proto = first(req.get('x-forwarded-proto')) || req.protocol || 'http';
  return `${proto}://${host}`;
}
