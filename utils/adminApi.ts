import { API_BASE, hasApi } from './api';

/**
 * The review desk's own client.
 *
 * Separate from apiFetch because the two authenticate differently: normal
 * requests carry a Privy bearer token belonging to a person, while these carry
 * a desk token from the shared password. Mixing them would mean every ordinary
 * request quietly gained admin scope if the header were ever set.
 *
 * The token is held in memory only — never written to storage — so closing the
 * app ends the session. On a shared password that is the right trade.
 */
let deskToken: string | null = null;

export const hasDeskSession = (): boolean => deskToken !== null;
export const endDeskSession = (): void => {
  deskToken = null;
};

export type AdminResult<T> = { ok: true; data: T } | { ok: false; detail: string };

async function call<T>(path: string, init: RequestInit = {}): Promise<AdminResult<T>> {
  if (!hasApi) return { ok: false, detail: 'This build has no server configured.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(`${API_BASE}/admin${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(deskToken ? { 'x-admin-token': deskToken } : {}),
        ...init.headers,
      },
    });

    const raw = await response.text();
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    if (!response.ok) {
      // A rejected token means the session is over, not that this one call
      // failed — clearing it sends the screen back to the password prompt
      // rather than leaving every later request failing silently.
      if (response.status === 401) deskToken = null;
      const detail =
        parsed && typeof parsed === 'object' && parsed !== null && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : `The server said ${response.status}.`;
      return { ok: false, detail };
    }
    return { ok: true, data: parsed as T };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      detail: aborted ? 'The server did not respond.' : 'Could not reach the server.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function deskLogin(password: string): Promise<AdminResult<{ expiresAt: number }>> {
  const result = await call<{ token: string; expiresAt: number }>('/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  if (!result.ok) return result;
  deskToken = result.data.token;
  return { ok: true, data: { expiresAt: result.data.expiresAt } };
}

export type Overview = {
  users: number;
  with_wallet: number;
  verified: number;
  questions: number;
  open_questions: number;
  tasks: number;
  disputes_to_decide: number;
  disputes_waiting: number;
  held_kobo: number;
};

export type AdminUser = {
  id: string;
  email: string | null;
  privyDid: string | null;
  walletAddress: string | null;
  createdAt: string;
  username: string | null;
  homeArea: string | null;
  onboardedAt: string | null;
  identityStatus: string;
  verifiedName: string | null;
  questionsAsked: number;
  jobsTaken: number;
};

export type ActivityRow = {
  kind: 'question' | 'job' | 'dispute' | 'money';
  id: string;
  at: string;
  detail: string | null;
  who: string | null;
  amount_kobo: number | null;
};

export type AdminDispute = {
  id: string;
  status: string;
  askerReason: string;
  verifierReply: string | null;
  adminNote: string | null;
  createdAt: string;
  questionId: string;
  question: string;
  bountyKobo: number;
  placeName: string | null;
  askerName: string | null;
  verifierName: string | null;
  evidenceKind: string | null;
  distanceMetres: number | null;
  /** The file itself, so a decision is made on the evidence and not its label. */
  evidenceUrl: string | null;
  capturedAt: string | null;
  /** What the verifier wrote when they sent it. */
  answer: string | null;
};

export const getOverview = () => call<Overview>('/overview');
export const getUsers = (q = '') =>
  call<{ users: AdminUser[] }>(`/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
export const getActivity = () => call<{ activity: ActivityRow[] }>('/activity');
export const getDisputes = () => call<{ disputes: AdminDispute[] }>('/disputes');

export const resolveDispute = (id: string, winner: 'asker' | 'verifier', note: string) =>
  call<{ ok: true }>(`/disputes/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ winner, note }),
  });

export const deleteUser = (id: string) =>
  call<{ ok: true }>(`/users/${id}`, { method: 'DELETE' });

/** Kobo is what the database stores; naira is what a person reads. */
export const koboToNaira = (kobo: number): string =>
  (kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 });

export type IdentityCheck = {
  id: string;
  status: 'pending' | 'verified' | 'rejected' | 'unverified';
  nin: string | null;
  submittedName: string | null;
  verifiedName: string | null;
  rejectionReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  userId: string;
  email: string | null;
  username: string | null;
};

export const getIdentityChecks = () => call<{ checks: IdentityCheck[] }>('/identity');

export const decideIdentity = (
  id: string,
  approve: boolean,
  verifiedName: string,
  reason: string,
) =>
  call<{ ok: true }>(`/identity/${id}/decide`, {
    method: 'POST',
    body: JSON.stringify({ approve, verifiedName, reason }),
  });
