import { apiFetch, hasApi } from '@/utils/api';
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { DEFAULT_DEADLINE, msUntilDeadline } from '@/constants/time';
import { FEE_PERCENT, VERIFIED_ONLY_ABOVE } from '@/constants/money';

export type NearbyTask = {
  id: string;
  title: string;
  description: string;
  location: string;
  area: string; // broad area for filtering e.g. "Ikeja"
  distance: string;
  reward: number;
  estimatedTime: string;
  category: 'fuel' | 'food' | 'traffic' | 'shopping' | 'safety';
  expiresIn: number;
  status: 'available' | 'accepted' | 'completed';
  viewersCount: number;
  /**
   * First name only. Never a phone number in either direction: nobody meets
   * anybody on this job, so there is no coordination that needs one, and a
   * number is the opening move in most "pay me directly" scams.
   */
  askerName?: string;
  /** The question this job was raised from, if it came from the Ask tab. */
  fromQueryId?: string;
  /** Restricted to verifiers who passed the NIN check. */
  verifiedOnly?: boolean;
  questions: {
    id: string;
    type: 'boolean' | 'text' | 'number';
    label: string;
    placeholder?: string;
  }[];
};

/**
 * A place a question is about.
 *
 * Deliberately shaped like a geocoder result rather than like our mock data,
 * so swapping the source (Google Places, Mapbox) for the local list means
 * changing where `Place[]` comes from and nothing else.
 */
export type Place = {
  id: string;
  name: string;
  area: string;
  coords?: { lat: number; lng: number };
  /** True when the user typed a place we do not have on file. */
  freeform?: boolean;
};

/**
 * Whether the answer you paid for may be shown to the next person who asks
 * about the same place. Public is the default because a shared answer is what
 * makes the instant path possible at all — but it is the payer's call, so it
 * is asked rather than assumed.
 */
export type Visibility = 'public' | 'private';

export type Query = {
  id: string;
  question: string;
  place: Place | null;
  bounty: number;
  visibility: Visibility;
  /** Minutes the verifier is given, chosen by the asker at dispatch. */
  deadlineMinutes: number;
  /** When the clock started. Null until it has been paid for. */
  dispatchedAt: number | null;
  /** Only identity-verified verifiers may take the job this raised. */
  verifiedOnly: boolean;
  /** Closed by the asker after the window ran out; the bounty went back. */
  closed?: boolean;
  createdAt: number;
};

/**
 * Where a paid question has got to, read from the job it created rather than
 * tracked separately — the two sides cannot disagree if there is only one
 * source of truth.
 */
export type QueryStatus =
  /** Paid, nobody has taken it, still inside the window. */
  | 'waiting'
  /** Somebody is on their way, still inside the window. */
  | 'accepted'
  /** The window ran out with no evidence. The asker may close it. */
  | 'overdue'
  /** Evidence is in. From here it cannot be closed, only confirmed or queried. */
  | 'answered'
  /** The asker closed it and took the money back. */
  | 'refunded';

export type ActiveQuestion = Query & { status: QueryStatus };

/**
 * A contested answer.
 *
 * The money stays held until an admin rules, and neither party can rule on
 * their own dispute — that is why review is a separate surface.
 *
 * The admin screen only offers the decide buttons once the verifier has
 * answered, so in practice both sides are heard. `resolveDispute` itself
 * does not require a reply, deliberately: a verifier who never answers must
 * not be able to strand the asker's money indefinitely.
 */
export type DisputeStatus =
  /** The asker objected; the verifier has not answered yet. */
  | 'awaiting_verifier'
  /** Both sides are in. Waiting on a human. */
  | 'awaiting_admin'
  /** Admin sided with the asker; the bounty went back. */
  | 'resolved_asker'
  /** Admin sided with the verifier; they were paid. */
  | 'resolved_verifier';

export type Dispute = {
  id: string;
  queryId: string;
  taskId: string | null;
  question: string;
  placeName: string;
  bounty: number;
  askerName: string;
  askerReason: string;
  verifierName: string;
  verifierReply: string | null;
  /** What the verifier sent, so an admin can judge without leaving the page. */
  evidence: { kind: 'photo' | 'video'; detail: string };
  status: DisputeStatus;
  adminNote: string | null;
  createdAt: number;
};

/** An answer somebody already paid for, reusable if they allowed it. */
export type CachedAnswer = {
  id: string;
  placeName: string;
  area: string;
  answer: string;
  detail: string;
  proof: 'photo' | 'video';
  /** The asker who paid for it accepted it. */
  confirmed: boolean;
  /** Hours since it was verified; drives how much to trust it. */
  ageHours: number;
  verifierName: string;
  verifierInitials: string;
  visibility: Visibility;
};

const CACHED_ANSWERS: CachedAnswer[] = [
  {
    id: 'c1',
    placeName: 'NNPC Station, Airport Road',
    area: 'Ikeja',
    answer: 'Petrol available. About 12 cars queuing.',
    detail: '₦895 per litre. Both pumps running.',
    proof: 'video',
    confirmed: true,
    ageHours: 6,
    verifierName: 'Akin',
    verifierInitials: 'AK',
    visibility: 'public',
  },
  {
    id: 'c2',
    placeName: 'Lekki Toll Gate',
    area: 'Lekki',
    answer: 'Heavy but moving. Roughly 20 minutes to clear.',
    detail: 'Three lanes open, no accident.',
    proof: 'video',
    confirmed: true,
    ageHours: 1,
    verifierName: 'Tunde',
    verifierInitials: 'TU',
    visibility: 'public',
  },
  {
    id: 'c3',
    placeName: 'Computer Village',
    area: 'Ikeja',
    answer: 'Open and busy as usual.',
    detail: 'Most stalls trading, main gate clear.',
    proof: 'photo',
    confirmed: true,
    ageHours: 3,
    verifierName: 'Ngozi',
    verifierInitials: 'NG',
    visibility: 'public',
  },
  {
    id: 'c4',
    placeName: 'Oyingbo Market',
    area: 'Lagos Island',
    answer: '50kg bag of rice is ₦85,000.',
    detail: 'Foreign parboiled. Prices steady since morning.',
    proof: 'video',
    confirmed: true,
    ageHours: 9,
    verifierName: 'Morenike',
    verifierInitials: 'MO',
    visibility: 'public',
  },
  {
    // Kept private by whoever paid for it, so it must never surface.
    id: 'c5',
    placeName: 'Mama Cass, Victoria Island',
    area: 'Victoria Island',
    answer: 'Open, roughly 15 minute wait.',
    detail: 'Half full, counter service quick.',
    proof: 'photo',
    confirmed: false,
    ageHours: 2,
    verifierName: 'Bisi',
    verifierInitials: 'BI',
    visibility: 'private',
  },
];

/**
 * An existing answer for this place, if one exists and its payer made it
 * public. Private answers are never returned — not even as a teaser — since
 * the whole point of the setting is that it stays unseen.
 */
export function findCachedAnswer(place: Place | null): CachedAnswer | null {
  if (!place) return null;
  const match = CACHED_ANSWERS.find(
    (entry) => entry.placeName.toLowerCase() === place.name.toLowerCase(),
  );
  return match && match.visibility === 'public' ? match : null;
}

/**
 * The address money is sent to, once Privy has made one.
 *
 * Null until the embedded wallet exists — which is a real state, not an edge
 * case: Privy provisions asynchronously, so there is a window right after
 * signing up where the account is live and the wallet is not.
 *
 * There is deliberately no placeholder to fall back on. This used to hold a
 * fake address behind a warning label, but the QR code rendered from it was
 * perfectly scannable, and a warning is a poor defence against a scanned code.
 * Showing nothing is the only safe thing to show when there is nowhere to send
 * money yet.
 */
export type WalletInfo = { address: string; chain: 'base' } | null;

/** Fallback label for a ledger row that carries no memo. */
function describeEntry(kind: string): string {
  switch (kind) {
    case 'earning':
      return 'Job payment';
    case 'deposit':
      return 'Top up';
    case 'hold':
      return 'Held for a question';
    case 'refund':
      return 'Refund';
    case 'tip':
      return 'Tip sent';
    case 'withdrawal':
      return 'Withdrawal';
    case 'fee':
      return 'Platform fee';
    default:
      return kind;
  }
}

export type WalletEntry = {
  id: string;
  amount: number;
  /** On-chain amount for deposits. Null for naira-denominated entries. */
  amountUsdc?: number | null;
  /** Set for anything that happened on Base, so it can be looked up. */
  txHash?: string | null;
  description: string;
  createdAt: number;
  pending: boolean;
  /** Mirrors the server's wallet_kind enum. Keep the two in step. */
  type: 'earning' | 'deposit' | 'tip' | 'hold' | 'refund' | 'withdrawal' | 'fee';
};

export type User = {
  email: string;
  isSignedIn: boolean;
};

/**
 * What other people see of you. Kept apart from `User` because the account is
 * the email and the password; this is the presentation, and it is editable.
 */
export type Profile = {
  name: string;
  username: string;
  /** Local file URI from the picker. Null falls back to initials. */
  avatarUri: string | null;
};

/** Which events are worth interrupting someone for. */
export type AlertPrefs = {
  jobsNearby: boolean;
  questionTaken: boolean;
  evidenceBack: boolean;
  payments: boolean;
  reviews: boolean;
  productNews: boolean;
};

const DEFAULT_ALERTS: AlertPrefs = {
  jobsNearby: true,
  questionTaken: true,
  evidenceBack: true,
  payments: true,
  reviews: true,
  // Off by default. Nobody installed this to hear from us.
  productNews: false,
};

/**
 * A suggested username for the welcome sheet's field. Never stored on its own.
 *
 * `name` is deliberately left empty. It used to be guessed from the email
 * local part — "chidi.okafor@…" became "Chidi" — which reads as a real name
 * while being nothing of the sort. The only name this app can stand behind is
 * the one returned by the NIN check, so until that happens there is no name.
 */
function profileFromEmail(email: string): Profile {
  const handle = email.split('@')[0] ?? '';
  return {
    name: '',
    username: handle.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20),
    avatarUri: null,
  };
}

/**
 * What a notification is about. The kind drives its colour code and where
 * tapping it takes you, so the list reads as a board rather than as prose.
 */
export type NotificationKind = 'job' | 'answer' | 'payment' | 'identity' | 'dispute';

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  ago: string;
  today: boolean;
  read: boolean;
};

const INITIAL_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'n1',
    kind: 'job',
    title: 'New job 300 m away',
    body: 'Check fuel availability · NNPC Station, Airport Road · ₦210',
    ago: '2 min',
    today: true,
    read: false,
  },
  {
    id: 'n2',
    kind: 'answer',
    title: 'Evidence came back',
    body: 'Akin sent video proof for your fuel question. Confirm it to release payment.',
    ago: '12 min',
    today: true,
    read: false,
  },
  {
    id: 'n3',
    kind: 'job',
    title: 'New job 1.2 km away',
    body: 'Restaurant crowd check · Mama Cass, Victoria Island · ₦350',
    ago: '38 min',
    today: true,
    read: false,
  },
  {
    id: 'n4',
    kind: 'payment',
    title: 'You were paid ₦630',
    body: `Fuel verification · Airport Road. Settled on Base after the ${FEE_PERCENT} fee.`,
    ago: '2 hr',
    today: true,
    read: true,
  },
  {
    id: 'n5',
    kind: 'dispute',
    title: 'Query resolved',
    body: 'The evidence held up on review, so payment stayed with the verifier.',
    ago: '5 hr',
    today: true,
    read: true,
  },
  {
    id: 'n6',
    kind: 'identity',
    title: 'Identity verified',
    body: 'NIMC confirmed your NIN. Jobs paying ₦500 and above are now open to you.',
    ago: 'Yesterday',
    today: false,
    read: true,
  },
  {
    id: 'n7',
    kind: 'answer',
    title: 'Your question was answered',
    body: 'Third Mainland Bridge · photo proof · confirmed by you.',
    ago: 'Yesterday',
    today: false,
    read: true,
  },
];

export type Identity = {
  nin: string;
  status: 'unverified' | 'pending' | 'verified' | 'rejected';
  /** The name on the NIN record. Only ever set by an approved review. */
  name: string | null;
  /** Why a reviewer turned it down, so it can be fixed and resubmitted. */
  reason: string | null;
};

export type AreaFilter = {
  key: string;
  label: string;
} | null;

/** A town or district, with the state it sits in. */
export type Area = { key: string; label: string; state: string };

export const AREAS: Area[] = [
  { key: 'ikeja', label: 'Ikeja', state: 'Lagos' },
  { key: 'vi', label: 'Victoria Island', state: 'Lagos' },
  { key: 'lekki', label: 'Lekki', state: 'Lagos' },
  { key: 'surulere', label: 'Surulere', state: 'Lagos' },
  { key: 'island', label: 'Lagos Island', state: 'Lagos' },
  { key: 'apapa', label: 'Apapa', state: 'Lagos' },
  { key: 'abuja', label: 'Abuja Central', state: 'FCT' },
  { key: 'ph', label: 'Port Harcourt', state: 'Rivers' },
  { key: 'ibadan', label: 'Ibadan', state: 'Oyo' },
  { key: 'benin', label: 'Benin City', state: 'Edo' },
];

/** The state an area sits in, for showing "Ikeja, Lagos" rather than "Ikeja". */
export function stateForArea(area: string): string | null {
  return AREAS.find((a) => a.label.toLowerCase() === area.toLowerCase())?.state ?? null;
}

export type FeedQuestion = {
  id: string;
  text: string;
  area: string;
  state: string;
  /** The spot the question is about, so picking one fills the place too. */
  placeName: string;
};

/** The place a feed question refers to, in the shape the composer expects. */
export function placeForQuestion(question: FeedQuestion): Place {
  return { id: `feed-${question.id}`, name: question.placeName, area: question.area };
}

export type AnsweredQuestion = {
  id: string;
  text: string;
  area: string;
  state: string;
  proof: 'photo' | 'video';
  /** The asker accepted it and released payment. */
  confirmed: boolean;
  ago: string;
};

/** What people around you are asking right now. */
const FEED_QUESTIONS: FeedQuestion[] = [
  { id: 'q1', text: 'Is there fuel at NNPC Airport Road?', placeName: 'NNPC Station, Airport Road', area: 'Ikeja', state: 'Lagos' },
  { id: 'q2', text: 'Is Computer Village open today?', placeName: 'Computer Village', area: 'Ikeja', state: 'Lagos' },
  { id: 'q3', text: 'How long is the queue at Mobil Allen Avenue?', placeName: 'Mobil Station, Allen Avenue', area: 'Ikeja', state: 'Lagos' },
  { id: 'q4', text: 'Is Chicken Republic VI still open?', placeName: 'Chicken Republic, Adeola Odeku', area: 'Victoria Island', state: 'Lagos' },
  { id: 'q5', text: 'How busy is Mama Cass right now?', placeName: 'Mama Cass, Victoria Island', area: 'Victoria Island', state: 'Lagos' },
  { id: 'q6', text: 'How bad is Lekki Toll Gate traffic?', placeName: 'Lekki Toll Gate', area: 'Lekki', state: 'Lagos' },
  { id: 'q7', text: 'Is Shoprite Lekki crowded this evening?', placeName: 'Shoprite, Lekki Phase 1', area: 'Lekki', state: 'Lagos' },
  { id: 'q8', text: 'Is Slot Electronics on Adeniran open?', placeName: 'Slot Electronics, Adeniran Ogunsanya', area: 'Surulere', state: 'Lagos' },
  { id: 'q9', text: 'Price of a 50kg bag of rice at Oyingbo?', placeName: 'Oyingbo Market', area: 'Lagos Island', state: 'Lagos' },
  { id: 'q10', text: 'Is Balogun Market busy today?', placeName: 'Balogun Market', area: 'Lagos Island', state: 'Lagos' },
  { id: 'q11', text: 'How bad is Third Mainland right now?', placeName: 'Third Mainland Bridge', area: 'Apapa', state: 'Lagos' },
  { id: 'q12', text: 'Is Wuse Market open this late?', placeName: 'Wuse Market', area: 'Abuja Central', state: 'FCT' },
  { id: 'q13', text: 'Any fuel around Garki right now?', placeName: 'Garki', area: 'Abuja Central', state: 'FCT' },
  { id: 'q14', text: 'Is Ring Road passable after the rain?', placeName: 'Ring Road', area: 'Benin City', state: 'Edo' },
  { id: 'q15', text: 'How long is the queue at Mile 1 Market?', placeName: 'Mile 1 Market', area: 'Port Harcourt', state: 'Rivers' },
  { id: 'q16', text: 'Is Bodija Market still open?', placeName: 'Bodija Market', area: 'Ibadan', state: 'Oyo' },
];

/**
 * Questions already settled.
 *
 * No confidence score. What makes one of these trustworthy is knowable and
 * true — what proof was sent, whether the asker accepted it, and how long
 * ago — so those are shown instead of a number nothing computes.
 */
const FEED_ANSWERED: AnsweredQuestion[] = [
  { id: 'a1', text: 'Fuel at NNPC Airport Road right now?', area: 'Ikeja', state: 'Lagos', proof: 'video', confirmed: true, ago: '4 min' },
  { id: 'a2', text: 'Is Computer Village crowded?', area: 'Ikeja', state: 'Lagos', proof: 'photo', confirmed: true, ago: '9 min' },
  { id: 'a3', text: 'Chicken Republic on VI still open?', area: 'Victoria Island', state: 'Lagos', proof: 'photo', confirmed: true, ago: '18 min' },
  { id: 'a4', text: 'Wait time at Mama Cass?', area: 'Victoria Island', state: 'Lagos', proof: 'photo', confirmed: false, ago: '25 min' },
  { id: 'a5', text: 'Lekki Toll Gate traffic this morning?', area: 'Lekki', state: 'Lagos', proof: 'video', confirmed: true, ago: '7 min' },
  { id: 'a6', text: 'Is Slot Surulere open?', area: 'Surulere', state: 'Lagos', proof: 'photo', confirmed: true, ago: '14 min' },
  { id: 'a7', text: 'Price of rice at Oyingbo Market?', area: 'Lagos Island', state: 'Lagos', proof: 'video', confirmed: true, ago: '31 min' },
  { id: 'a8', text: 'Traffic on Third Mainland Bridge?', area: 'Apapa', state: 'Lagos', proof: 'photo', confirmed: false, ago: '12 min' },
  { id: 'a9', text: 'Fuel around Wuse right now?', area: 'Abuja Central', state: 'FCT', proof: 'video', confirmed: true, ago: '6 min' },
  { id: 'a10', text: 'Is Ring Road flooded?', area: 'Benin City', state: 'Edo', proof: 'video', confirmed: true, ago: '22 min' },
  { id: 'a11', text: 'Mile 1 Market crowd level?', area: 'Port Harcourt', state: 'Rivers', proof: 'photo', confirmed: false, ago: '35 min' },
  { id: 'a12', text: 'Bodija Market prices today?', area: 'Ibadan', state: 'Oyo', proof: 'photo', confirmed: true, ago: '41 min' },
];

/**
 * Your town first, then the rest of your state.
 *
 * Falling through to the state matters: someone in Lekki should still see
 * that Third Mainland is jammed, and a quiet district would otherwise show
 * an empty feed.
 */
function forArea<T extends { area: string; state: string }>(items: T[], home: Area): T[] {
  const inTown = items.filter((item) => item.area === home.label);
  const inState = items.filter(
    (item) => item.area !== home.label && item.state === home.state,
  );
  return [...inTown, ...inState];
}

type AppContextType = {
  user: User | null;
  identity: Identity;
  /** Null until Privy finishes creating the embedded wallet. */
  wallet: WalletInfo;
  setWallet: (wallet: WalletInfo) => void;
  /** The area this account calls home; drives the nearby feeds. */
  homeArea: Area;
  setHomeArea: (area: Area) => void;
  profile: Profile;
  updateProfile: (patch: Partial<Profile>) => void;
  /**
   * False until the first-run sheet has been answered or skipped.
   *
   * Kept separate from `profile.name` because skipping is a valid outcome:
   * somebody who declines to add a name has still been asked, and asking them
   * again on every launch would be nagging rather than onboarding.
   */
  onboarded: boolean;
  finishOnboarding: () => void;
  /** True once the server has answered — see the state declaration. */
  accountLoaded: boolean;
  setAccountLoaded: (loaded: boolean) => void;
  /** Confirmed jobs, counted on the server. */
  jobsDone: number;
  questionsAsked: number;
  totalDepositedUsdc: number;
  /** False until the ledger has been fetched. */
  walletLoaded: boolean;
  refreshWallet: () => Promise<void>;
  alertPrefs: AlertPrefs;
  setAlertPref: (key: keyof AlertPrefs, value: boolean) => void;
  /** Seeds settings from the server. Does not write back. */
  applyPreferences: (
    prefs: Partial<AlertPrefs> & { answersPublicByDefault?: boolean },
  ) => void;
  /** Pre-selects the sharing switch when a question is dispatched. */
  answersPublicByDefault: boolean;
  setAnswersPublicByDefault: (value: boolean) => void;
  questionsNearby: FeedQuestion[];
  answeredNearby: AnsweredQuestion[];
  /** Paid questions still in flight, newest first. */
  activeQuestions: ActiveQuestion[];
  /** Paid questions that have been answered and settled. */
  answeredQuestions: ActiveQuestion[];
  /** Jobs you accepted and have not yet finished. */
  activeJobs: NearbyTask[];
  /** Jobs you finished and were paid for. */
  completedJobs: NearbyTask[];
  notifications: AppNotification[];
  unreadCount: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  locationFilter: AreaFilter;
  queries: Query[];
  nearbyTasks: NearbyTask[];
  walletBalance: number;
  pendingBalance: number;
  walletHistory: WalletEntry[];
  /** On-chain USDC. Null until read; never zeroed by a failed read. */
  usdcBalance: number | null;
  /** Block the balance was read at, so the UI can show it is live. */
  balanceBlock: number | null;
  /** Live USD→NGN, or null when unavailable. */
  ngnPerUsd: number | null;
  refreshBalance: () => Promise<void>;
  signIn: (email: string) => void;
  signOut: () => void;
  submitNin: (nin: string, fullName: string) => Promise<{ ok: boolean; detail?: string }>;
  refreshIdentity: () => Promise<void>;
  setLocationFilter: (filter: AreaFilter) => void;
  depositUsdc: (amount: number) => void;
  /** Sends USDC out to an address the user controls. */
  withdrawUsdc: (amount: number, toAddress: string) => void;
  addQuery: (question: string, place: Place | null) => string;
  /**
   * Committing to pay a human. Separate from asking, because most questions
   * should never reach this point — the price is only decided once the AI has
   * failed and a person actually has to walk somewhere.
   */
  dispatchQuery: (
    id: string,
    bounty: number,
    visibility: Visibility,
    deadlineMinutes: number,
    verifiedOnly: boolean,
  ) => void;
  /**
   * Give up on an overdue question and take the money back. Refused once
   * evidence exists — somebody has already walked there by then.
   */
  closeQuery: (id: string) => void;
  tipVerifier: (amount: number, verifierName: string) => void;

  disputes: Dispute[];
  /** Raised by the asker. A reason is required — "wrong" is not reviewable. */
  openDispute: (input: {
    queryId: string;
    taskId: string | null;
    question: string;
    placeName: string;
    bounty: number;
    verifierName: string;
    reason: string;
    evidence: { kind: 'photo' | 'video'; detail: string };
  }) => void;
  replyToDispute: (id: string, reply: string) => void;
  /** Admin only. Moves the held money to whichever side was right. */
  resolveDispute: (id: string, winner: 'asker' | 'verifier', note: string) => void;
  disputeForQuery: (queryId: string) => Dispute | null;
  acceptTask: (taskId: string) => void;
  completeTask: (taskId: string, reward: number, description: string) => void;
};

const AppContext = createContext<AppContextType | null>(null);

/** Best guess at what a question is about, for the job's colour code. */
function inferCategory(question: string): NearbyTask['category'] {
  const q = question.toLowerCase();
  if (/fuel|petrol|diesel|filling|pump|nnpc|mobil/.test(q)) return 'fuel';
  if (/traffic|road|bridge|jam|flood|toll|passable/.test(q)) return 'traffic';
  if (/food|restaurant|eat|chicken|crowd|open|busy/.test(q)) return 'food';
  if (/safe|security|danger|police/.test(q)) return 'safety';
  return 'shopping';
}

/** "akin@example.com" -> "Akin". First names only, by design. */
function firstNameFrom(email: string | undefined): string {
  const handle = (email ?? 'someone').split('@')[0].split(/[._-]/)[0];
  return handle.charAt(0).toUpperCase() + handle.slice(1);
}

/**
 * A paid question becomes a job on the Earn board. One job, one verifier —
 * it leaves the board the moment somebody accepts it.
 */
function taskFromQuery(query: Query, bounty: number, askerName: string): NearbyTask {
  return {
    id: `t-${query.id}`,
    title: query.question,
    description: `Go to ${query.place?.name ?? 'the place'} and answer the asker's question in person. Photo or video proof required.`,
    location: query.place?.name ?? 'Unknown place',
    area: query.place?.area ?? '',
    distance: 'Nearby',
    reward: bounty,
    estimatedTime: '~5 min',
    category: inferCategory(query.question),
    expiresIn: 900,
    status: 'available',
    viewersCount: 1,
    askerName,
    fromQueryId: query.id,
    verifiedOnly: query.verifiedOnly,
    questions: [
      {
        id: 'a1',
        type: 'text',
        label: query.question,
        placeholder: 'Answer in a sentence',
      },
    ],
  };
}

const INITIAL_TASKS: NearbyTask[] = [
  {
    id: 't1',
    title: 'Check fuel availability',
    description:
      'Visit the NNPC station on Airport Road. Check if petrol is available and take a photo of the pump area.',
    location: 'NNPC Station, Airport Road',
    area: 'Ikeja',
    distance: '0.3 km',
    reward: 300,
    estimatedTime: '~3 min',
    category: 'fuel',
    expiresIn: 600,
    status: 'available',
    viewersCount: 4,
    questions: [
      { id: 'q1', type: 'boolean', label: 'Is petrol available?' },
      { id: 'q2', type: 'number', label: 'Price per litre (₦)', placeholder: 'e.g. 895' },
      { id: 'q3', type: 'text', label: 'Estimated queue length', placeholder: 'e.g. ~10 cars' },
    ],
  },
  {
    id: 't2',
    title: 'Restaurant crowd check',
    description:
      'Visit Mama Cass on Victoria Island. Take a quick photo and report current crowd levels.',
    location: 'Mama Cass, Victoria Island',
    area: 'Victoria Island',
    distance: '1.2 km',
    reward: 500,
    estimatedTime: '~5 min',
    category: 'food',
    expiresIn: 900,
    status: 'available',
    viewersCount: 7,
    questions: [
      { id: 'q1', type: 'boolean', label: 'Is the restaurant open?' },
      { id: 'q2', type: 'text', label: 'How busy is it?', placeholder: 'e.g. Half full, ~15 min wait' },
    ],
  },
  {
    id: 't3',
    title: 'Verify store hours',
    description: 'Check if Slot Electronics on Adeniran Ogunsanya is currently open.',
    location: 'Slot Electronics, Surulere',
    area: 'Surulere',
    distance: '0.4 km',
    reward: 200,
    estimatedTime: '~2 min',
    category: 'shopping',
    expiresIn: 450,
    status: 'available',
    viewersCount: 2,
    questions: [
      { id: 'q1', type: 'boolean', label: 'Is the store open?' },
      { id: 'q2', type: 'text', label: 'Any notices or signs?', placeholder: 'Optional' },
    ],
  },
  {
    id: 't4',
    title: 'Road flooding status',
    description: 'Check Ring Road for flooding — can regular cars pass safely?',
    location: 'Ring Road, Benin City',
    area: 'Benin City',
    distance: '2.1 km',
    reward: 400,
    estimatedTime: '~4 min',
    category: 'traffic',
    expiresIn: 300,
    status: 'available',
    viewersCount: 3,
    questions: [
      { id: 'q1', type: 'boolean', label: 'Is there flooding on the road?' },
      { id: 'q2', type: 'text', label: 'Severity?', placeholder: 'e.g. Moderate, passable with care' },
    ],
  },
  {
    id: 't5',
    title: 'Market price check',
    description: 'Check the current price of a 50kg bag of rice at Oyingbo Market.',
    location: 'Oyingbo Market, Lagos',
    area: 'Lagos Island',
    distance: '0.8 km',
    reward: 250,
    estimatedTime: '~3 min',
    category: 'shopping',
    expiresIn: 720,
    status: 'available',
    viewersCount: 5,
    questions: [
      { id: 'q1', type: 'number', label: 'Price of 50kg rice bag (₦)', placeholder: 'e.g. 85000' },
      { id: 'q2', type: 'text', label: 'Brand / quality', placeholder: 'e.g. Tomato rice, foreign' },
    ],
  },
];

/**
 * A new account starts empty, because a new account *is* empty.
 *
 * This used to hold six invented earnings totalling ₦1,700 across five jobs.
 * They rendered in the same place as real figures with no way to tell them
 * apart, so the profile reported work that had never happened and money that
 * did not exist. Real entries arrive from /auth/wallet.
 */
const INITIAL_WALLET: WalletEntry[] = [];

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [identity, setIdentity] = useState<Identity>({
    nin: '',
    status: 'unverified',
    name: null,
    reason: null,
  });
  const [wallet, setWallet] = useState<WalletInfo>(null);
  const [homeArea, setHomeArea] = useState<Area>(AREAS[0]);
  const [profile, setProfile] = useState<Profile>({ name: '', username: '', avatarUri: null });
  const [onboarded, setOnboarded] = useState(false);
  /**
   * False until the server has been asked what this account looks like.
   *
   * Without it, every screen has to treat "not loaded yet" and "loaded, and
   * the answer is no" as the same thing. The welcome sheet did exactly that
   * and reopened on every refresh, because local state starts at
   * `onboarded: false` and the answer only arrives a round trip later.
   */
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [alertPrefs, setAlertPrefs] = useState<AlertPrefs>(DEFAULT_ALERTS);
  const [answersPublicByDefault, setAnswersPublicByDefault] = useState(true);
  const [notifications, setNotifications] = useState<AppNotification[]>(INITIAL_NOTIFICATIONS);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [locationFilter, setLocationFilter] = useState<AreaFilter>(null);
  const [queries, setQueries] = useState<Query[]>([]);

  // Mirrors `queries` so dispatchQuery can read the question it is being
  // paid for without taking the whole list as a dependency.
  const queriesRef = useRef<Query[]>([]);
  useEffect(() => {
    queriesRef.current = queries;
  }, [queries]);

  // Mirrors the board so closeQuery can check for evidence without taking
  // the whole task list as a dependency.
  const tasksRef = useRef<NearbyTask[]>([]);

  // Mirrors the disputes so resolveDispute can read the one it is settling.
  const disputesRef = useRef<Dispute[]>([]);
  const [nearbyTasks, setNearbyTasks] = useState<NearbyTask[]>(INITIAL_TASKS);
  useEffect(() => {
    tasksRef.current = nearbyTasks;
  }, [nearbyTasks]);

  useEffect(() => {
    disputesRef.current = disputes;
  }, [disputes]);
  const [walletHistory, setWalletHistory] = useState<WalletEntry[]>(INITIAL_WALLET);
  /**
   * The on-chain USDC balance, or null when it has not been read.
   *
   * Null is a real state and is rendered differently from zero: "we could not
   * ask the chain" and "you have nothing" are opposite messages, and showing
   * $0.00 for the first is a claim about someone's money we are in no position
   * to make.
   */
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [balanceBlock, setBalanceBlock] = useState<number | null>(null);
  /**
   * Live USD→NGN. Null when the rate could not be fetched, which hides the
   * naira figure rather than falling back to a hard-coded number that would
   * look identical to a real one.
   */
  const [ngnPerUsd, setNgnPerUsd] = useState<number | null>(null);
  /** Counted from confirmed jobs on the server, not from ledger rows. */
  const [jobsDone, setJobsDone] = useState(0);
  /** Sum of deposits in USDC, which is the currency they arrived in. */
  const [totalDepositedUsdc, setTotalDepositedUsdc] = useState(0);
  const [questionsAsked, setQuestionsAsked] = useState(0);
  const [walletLoaded, setWalletLoaded] = useState(false);

  // Status comes from the job each question created, so the asker's view and
  // the verifier's view can never drift apart.
  const paidQuestions: ActiveQuestion[] = queries
    .filter((q) => q.bounty > 0)
    .map((q) => {
      const job = nearbyTasks.find((t) => t.fromQueryId === q.id);
      const overdue = msUntilDeadline(q.dispatchedAt, q.deadlineMinutes) <= 0;

      // Order matters. Evidence outranks the clock: once it is in, a passed
      // deadline no longer entitles the asker to the money back.
      const status: QueryStatus = q.closed
        ? 'refunded'
        : job?.status === 'completed'
          ? 'answered'
          : overdue
            ? 'overdue'
            : job?.status === 'accepted'
              ? 'accepted'
              : 'waiting';

      return { ...q, status };
    })
    .reverse();

  // Money out: tips, and bounties held against an open question. Money in:
  // earnings, top-ups, and refunds when a question is closed unanswered.
  const walletBalance = walletHistory
    .filter((e) => !e.pending)
    .reduce(
      (sum, e) => (e.type === 'tip' || e.type === 'hold' ? sum - e.amount : sum + e.amount),
      0,
    );
  const pendingBalance = walletHistory.filter((e) => e.pending).reduce((s, e) => s + e.amount, 0);

  /**
   * Opens the session. Deliberately does not invent a username.
   *
   * This used to seed one from the email local part, which then rendered
   * everywhere as though the person had chosen it — so someone whose real
   * username was "soke" saw "@coolexcollins" until /auth/me answered, and kept
   * seeing it for good if that request failed. A guess that is indistinguishable
   * from the real value is worse than a blank.
   *
   * The welcome sheet still offers the same suggestion, but as a default in an
   * editable field rather than as a stored fact.
   */
  const signIn = useCallback((email: string) => {
    setUser({ email, isSignedIn: true });
  }, []);

  const finishOnboarding = useCallback(() => setOnboarded(true), []);

  const signOut = useCallback(() => {
    setUser(null);
  }, []);

  /**
   * Flips a setting and saves it, rolling back if the save fails.
   *
   * Optimistic on purpose: a toggle that waits on a round trip before moving
   * feels broken, and these are low-stakes. But it must not *lie* — if the
   * write fails the switch goes back to where it was, so what is on screen is
   * always what is stored rather than what was merely attempted.
   */
  /**
   * Pulls the ledger and the figures derived from it.
   *
   * Kobo on the wire, naira in the app: the server stores integers so nothing
   * drifts, and the conversion happens here, once, rather than at each screen
   * that shows an amount.
   */
  /**
   * Lets refreshBalance call refreshWallet without either having to be
   * declared first — they are mutually reachable, and a direct reference in
   * the dependency array would need one of them to exist before the other.
   */
  const refreshWalletRef = useRef<(() => Promise<void>) | null>(null);

  const refreshWallet = useCallback(async () => {
    if (!hasApi) {
      setWalletLoaded(true);
      return;
    }

    const result = await apiFetch<{
      balanceKobo: number;
      earnedKobo: number;
      depositedUsdc: number;
      jobsDone: number;
      questionsAsked: number;
      entries: {
        id: string;
        kind: WalletEntry['type'];
        amountKobo: number;
        amountUsdc: number | null;
        txHash: string | null;
        pending: boolean;
        memo: string | null;
        createdAt: string;
        question: string | null;
      }[];
    }>('/auth/wallet');

    if (!result.ok) {
      setWalletLoaded(true);
      return;
    }

    setWalletHistory(
      result.data.entries.map((e) => ({
        id: e.id,
        amount: e.amountKobo / 100,
        // Present only for on-chain rows. Deposits are denominated in USDC,
        // so the naira column is a conversion rather than the amount itself.
        amountUsdc: e.amountUsdc,
        txHash: e.txHash,
        description: e.memo ?? e.question ?? describeEntry(e.kind),
        createdAt: new Date(e.createdAt).getTime(),
        pending: e.pending,
        type: e.kind,
      })),
    );
    setTotalDepositedUsdc(result.data.depositedUsdc);
    setJobsDone(result.data.jobsDone);
    setQuestionsAsked(result.data.questionsAsked);
    setWalletLoaded(true);
  }, []);

  refreshWalletRef.current = refreshWallet;

  /**
   * Reads the balance straight from Base.
   *
   * Polled rather than pushed: an HTTP RPC has no way to tell us a transfer
   * happened, so the choice is between asking periodically and holding a
   * WebSocket subscription open to a node. Polling while the wallet is on
   * screen is a fraction of the complexity and, at Base's ~2s blocks, close
   * enough to live that the difference is not visible.
   */
  const refreshBalance = useCallback(async () => {
    if (!hasApi) return;

    /**
     * Scan for new deposits before reading the balance back.
     *
     * Ordered this way so a top-up appears in the balance and in the activity
     * list in the same refresh. Doing it after would show the money without
     * the row explaining it until the next poll.
     *
     * Safe to call on every refresh: the unique index on (tx_hash, log_index)
     * means an already-recorded transfer is skipped by the database.
     */
    const sync = await apiFetch<{ inserted: number }>('/auth/deposits/sync', { method: 'POST' });

    const result = await apiFetch<{
      usdc: number | null;
      blockNumber: number | null;
      ngnPerUsd: number | null;
      status: string;
    }>('/auth/balance');

    if (!result.ok || result.data.usdc === null) {
      // Left as it was rather than zeroed — a failed read is not a balance.
      setBalanceBlock(null);
      return;
    }

    setUsdcBalance(result.data.usdc);
    setBalanceBlock(result.data.blockNumber);
    if (result.data.ngnPerUsd) setNgnPerUsd(result.data.ngnPerUsd);

    // Only re-read the ledger when something actually landed, rather than
    // re-fetching it every twelve seconds for no change.
    if (sync.ok && sync.data.inserted > 0) void refreshWalletRef.current?.();
  }, []);

  const setAlertPref = useCallback((key: keyof AlertPrefs, value: boolean) => {
    setAlertPrefs((prev) => ({ ...prev, [key]: value }));
    if (!hasApi) return;

    void (async () => {
      const result = await apiFetch('/auth/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: value }),
      });
      if (!result.ok) {
        setAlertPrefs((prev) => ({ ...prev, [key]: !value }));
        console.warn(`[prefs] ${key} did not save — ${result.detail}`);
      }
    })();
  }, []);

  /** Same contract as the alert toggles: optimistic, but never a false state. */
  const setAnswersPublic = useCallback((value: boolean) => {
    setAnswersPublicByDefault(value);
    if (!hasApi) return;

    void (async () => {
      const result = await apiFetch('/auth/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ answersPublicByDefault: value }),
      });
      if (!result.ok) {
        setAnswersPublicByDefault(!value);
        console.warn(`[prefs] answersPublicByDefault did not save — ${result.detail}`);
      }
    })();
  }, []);

  /** Applies what the server has, without triggering a write back to it. */
  const applyPreferences = useCallback(
    (prefs: Partial<AlertPrefs> & { answersPublicByDefault?: boolean }) => {
      const { answersPublicByDefault: shared, ...alerts } = prefs;
      if (Object.keys(alerts).length > 0) {
        setAlertPrefs((prev) => ({ ...prev, ...alerts }));
      }
      if (typeof shared === 'boolean') setAnswersPublicByDefault(shared);
    },
    [],
  );

  const updateProfile = useCallback((patch: Partial<Profile>) => {
    setProfile((prev) => ({ ...prev, ...patch }));
  }, []);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  /**
   * Sends a NIN for review. Nothing here decides the outcome.
   *
   * This used to set `pending`, wait three seconds on a timer, and then set
   * `verified` — every person who typed eleven digits became verified, which
   * made the shield next to a name mean nothing at all. The decision now
   * belongs to a reviewer, and this only reports what the server accepted.
   */
  const submitNin = useCallback(
    async (nin: string, fullName: string): Promise<{ ok: boolean; detail?: string }> => {
      if (!hasApi) {
        return { ok: false, detail: 'No server is configured in this build.' };
      }

      const result = await apiFetch<{ status: string }>('/identity/submit', {
        method: 'POST',
        body: JSON.stringify({ nin, fullName }),
      });

      if (!result.ok) {
        // An already-queued check is not an error worth alarming anyone with.
        if (result.code === 'already_pending') {
          setIdentity((prev) => ({ ...prev, nin, status: 'pending', reason: null }));
          return { ok: true };
        }
        return { ok: false, detail: result.detail };
      }

      setIdentity((prev) => ({ ...prev, nin, status: 'pending', reason: null }));
      return { ok: true };
    },
    [],
  );

  /** Reads the reviewer's decision. Called on mount and on demand. */
  const refreshIdentity = useCallback(async () => {
    if (!hasApi) return;
    const result = await apiFetch<{
      status: Identity['status'];
      name: string | null;
      reason: string | null;
    }>('/identity/status');
    if (!result.ok) return;
    setIdentity((prev) => ({
      ...prev,
      status: result.data.status,
      name: result.data.name,
      reason: result.data.reason,
    }));
  }, []);

  const withdrawUsdc = useCallback((amount: number, toAddress: string) => {
    // Deliberately does not touch usdcBalance. That number is read from Base,
    // and nothing here broadcasts a transaction — decrementing it would show
    // money leaving a wallet it is still sitting in.
    setWalletHistory((prev) => [
      {
        id: `wd-${Date.now()}`,
        amount,
        // Only the ends of the address: enough to recognise the destination,
        // short enough to read in a list.
        description: `Withdrawn to ${toAddress.slice(0, 6)}…${toAddress.slice(-4)}`,
        createdAt: Date.now(),
        pending: false,
        type: 'withdrawal',
      },
      ...prev,
    ]);
  }, []);

  const depositUsdc = useCallback((amount: number) => {
    // Only meaningful once a real balance has been read; adding to an unknown
    // would invent one.
    setUsdcBalance((b) => (b === null ? b : b + amount));
    const id = Date.now().toString();
    setWalletHistory((prev) => [
      { id, amount, description: `USDC deposit · Base network`, createdAt: Date.now(), pending: false, type: 'deposit' },
      ...prev,
    ]);
  }, []);

  const addQuery = useCallback((question: string, place: Place | null): string => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 8);
    setQueries((prev) => [
      ...prev,
      // No bounty yet: asking is free, and most questions never need one.
      {
        id,
        question,
        place,
        bounty: 0,
        visibility: 'public',
        deadlineMinutes: DEFAULT_DEADLINE,
        dispatchedAt: null,
        verifiedOnly: false,
        createdAt: Date.now(),
      },
    ]);
    return id;
  }, []);

  const dispatchQuery = useCallback(
    (
      id: string,
      bounty: number,
      visibility: Visibility,
      deadlineMinutes: number,
      verifiedOnly: boolean,
    ) => {
      const query = queriesRef.current.find((q) => q.id === id);
      if (!query || query.dispatchedAt) return;

      const dispatchedAt = Date.now();
      // Big errands are restricted whether or not the asker ticked the box.
      const restricted = verifiedOnly || bounty >= VERIFIED_ONLY_ABOVE;

      setQueries((prev) =>
        prev.map((q) =>
          q.id === id
            ? { ...q, bounty, visibility, deadlineMinutes, dispatchedAt, verifiedOnly: restricted }
            : q,
        ),
      );

      // The money leaves the wallet now and is held until the question is
      // answered or the asker closes it. Without a hold, a later refund
      // would be inventing money.
      setWalletHistory((prev) => [
        {
          id: `hold-${id}`,
          amount: bounty,
          description: `Held for "${query.question}"`,
          createdAt: dispatchedAt,
          pending: false,
          type: 'hold',
        },
        ...prev,
      ]);

      // Paying for it is what puts the job on the Earn board. Guarded so a
      // second press cannot post the same question twice.
      setNearbyTasks((prev) => {
        if (prev.some((t) => t.fromQueryId === id)) return prev;
        return [
          taskFromQuery(
            { ...query, bounty, visibility, deadlineMinutes, dispatchedAt, verifiedOnly: restricted },
            bounty,
            firstNameFrom(user?.email),
          ),
          ...prev,
        ];
      });
    },
    [user?.email],
  );

  const closeQuery = useCallback((id: string) => {
    const query = queriesRef.current.find((q) => q.id === id);
    if (!query || query.closed) return;

    // Evidence in hand means somebody already did the walking, so the money
    // is no longer the asker's to take back.
    const job = tasksRef.current.find((t) => t.fromQueryId === id);
    if (job?.status === 'completed') return;

    setQueries((prev) => prev.map((q) => (q.id === id ? { ...q, closed: true } : q)));

    // Pull the job off the board so nobody sets out for money that has gone.
    setNearbyTasks((prev) => prev.filter((t) => t.fromQueryId !== id));

    setWalletHistory((prev) => [
      {
        id: `refund-${id}`,
        amount: query.bounty,
        description: `Refunded · "${query.question}"`,
        createdAt: Date.now(),
        pending: false,
        type: 'refund',
      },
      ...prev,
    ]);
  }, []);

  const openDispute = useCallback(
    (input: {
      queryId: string;
      taskId: string | null;
      question: string;
      placeName: string;
      bounty: number;
      verifierName: string;
      reason: string;
      evidence: { kind: 'photo' | 'video'; detail: string };
    }) => {
      setDisputes((prev) => {
        if (prev.some((d) => d.queryId === input.queryId)) return prev;
        return [
          {
            id: `d-${input.queryId}`,
            queryId: input.queryId,
            taskId: input.taskId,
            question: input.question,
            placeName: input.placeName,
            bounty: input.bounty,
            askerName: firstNameFrom(user?.email),
            askerReason: input.reason,
            verifierName: input.verifierName,
            verifierReply: null,
            evidence: input.evidence,
            status: 'awaiting_verifier',
            adminNote: null,
            createdAt: Date.now(),
          },
          ...prev,
        ];
      });
    },
    [user?.email],
  );

  const replyToDispute = useCallback((id: string, reply: string) => {
    setDisputes((prev) =>
      prev.map((d) =>
        d.id === id && d.status === 'awaiting_verifier'
          ? { ...d, verifierReply: reply, status: 'awaiting_admin' }
          : d,
      ),
    );
  }, []);

  const resolveDispute = useCallback(
    (id: string, winner: 'asker' | 'verifier', note: string) => {
      const dispute = disputesRef.current.find((d) => d.id === id);
      if (!dispute || dispute.status.startsWith('resolved')) return;

      setDisputes((prev) =>
        prev.map((d) =>
          d.id === id
            ? {
                ...d,
                status: winner === 'asker' ? 'resolved_asker' : 'resolved_verifier',
                adminNote: note.trim() || null,
              }
            : d,
        ),
      );

      // The held money has been sitting since dispatch. It moves now, once.
      if (winner === 'asker') {
        setWalletHistory((prev) => [
          {
            id: `dispute-refund-${id}`,
            amount: dispute.bounty,
            description: `Dispute upheld · "${dispute.question}"`,
            createdAt: Date.now(),
            pending: false,
            type: 'refund',
          },
          ...prev,
        ]);
        setQueries((prev) =>
          prev.map((q) => (q.id === dispute.queryId ? { ...q, closed: true } : q)),
        );
        if (dispute.taskId) {
          setNearbyTasks((prev) => prev.filter((t) => t.id !== dispute.taskId));
        }
      } else if (dispute.taskId) {
        setNearbyTasks((prev) =>
          prev.map((t) => (t.id === dispute.taskId ? { ...t, status: 'completed' as const } : t)),
        );
      }
    },
    [],
  );

  const tipVerifier = useCallback((amount: number, verifierName: string) => {
    setWalletHistory((prev) => [
      {
        id: `tip-${Date.now()}`,
        amount,
        description: `Tip to ${verifierName}`,
        createdAt: Date.now(),
        pending: false,
        type: 'tip',
      },
      ...prev,
    ]);
  }, []);

  const acceptTask = useCallback((taskId: string) => {
    setNearbyTasks((prev) =>
      prev.map((t) =>
        // One verifier per job. Anything already taken stays taken, so a
        // second person cannot walk to the same place for the same money.
        t.id === taskId && t.status === 'available'
          ? { ...t, status: 'accepted' as const }
          : t,
      ),
    );
  }, []);

  const completeTask = useCallback((taskId: string, reward: number, description: string) => {
    setNearbyTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: 'completed' as const } : t)),
    );
    const id = Date.now().toString();
    setWalletHistory((prev) => [
      { id, amount: reward, description, createdAt: Date.now(), pending: false, type: 'earning' },
      ...prev,
    ]);
  }, []);

  return (
    <AppContext.Provider
      value={{
        user, identity, refreshIdentity, wallet, setWallet, locationFilter,
        homeArea, setHomeArea, profile, updateProfile, onboarded, finishOnboarding,
        accountLoaded, setAccountLoaded,
        jobsDone, questionsAsked, totalDepositedUsdc, walletLoaded, refreshWallet,
        alertPrefs, setAlertPref, applyPreferences,
        answersPublicByDefault, setAnswersPublicByDefault: setAnswersPublic,
        questionsNearby: forArea(FEED_QUESTIONS, homeArea),
        answeredNearby: forArea(FEED_ANSWERED, homeArea),

        // Only paid questions: an unpaid one has nobody working on it and so
        // has nothing to follow.
        activeQuestions: paidQuestions.filter((q) => q.status !== 'answered'),
        answeredQuestions: paidQuestions.filter((q) => q.status === 'answered'),

        activeJobs: nearbyTasks.filter((t) => t.status === 'accepted'),
        completedJobs: nearbyTasks.filter((t) => t.status === 'completed'),
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
        markNotificationRead,
        markAllNotificationsRead,
        queries, nearbyTasks,
        walletBalance, pendingBalance,
        walletHistory: walletHistory.filter((e) => !e.pending),
        usdcBalance, balanceBlock, ngnPerUsd, refreshBalance,
        signIn, signOut, submitNin,
        setLocationFilter, depositUsdc, withdrawUsdc,
        addQuery, dispatchQuery, closeQuery, tipVerifier, acceptTask, completeTask,
        disputes, openDispute, replyToDispute, resolveDispute,
        disputeForQuery: (queryId: string) =>
          disputes.find((d) => d.queryId === queryId) ?? null,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
