import 'dotenv/config';

/**
 * Accepts a private key with or without the 0x prefix.
 *
 * Exporters disagree: some hand back 64 bare hex characters, others prefix
 * them. Both are the same key, and rejecting one of them produces a
 * "withdrawals unavailable" message that gives no hint the only problem is two
 * missing characters.
 */
function normaliseKey(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return '';
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

/**
 * Every threshold is tunable from the environment, because the defaults below
 * are educated starting points rather than measured ones. They were chosen
 * from how the metrics behave in general, not from a corpus of real Lagos
 * street photos. Expect to move them once there is a week of real submissions
 * to look at — that is why none of them are hard-coded at the call site.
 */
export const config = {
  port: num('PORT', 8080),
  databaseUrl: process.env.DATABASE_URL ?? '',

  /** Where uploads land. See storage.ts — the disk driver is dev-only. */
  storageDriver: (process.env.STORAGE_DRIVER ?? 'disk') as 'disk',
  storageDir: process.env.STORAGE_DIR ?? '.uploads',

  /**
   * Privy. The app ID is public and also ships in the client; the secret is
   * server-only and must never reach the bundle — anything prefixed
   * EXPO_PUBLIC_ is inlined into the app and readable by anyone who installs
   * it.
   */
  privy: {
    appId: process.env.PRIVY_APP_ID ?? '',
    appSecret: process.env.PRIVY_APP_SECRET ?? '',
  },

  /**
   * The review desk's shared password, stored only as a scrypt hash. The
   * plaintext exists nowhere on the server — see adminAuth.ts.
   */
  admin: { passwordHash: process.env.ADMIN_PASSWORD_HASH ?? '' },

  /**
   * Base mainnet. The defaults are the public endpoint and the canonical USDC
   * contract, both overridable — the public RPC rate-limits, so anything with
   * real traffic wants an Alchemy or QuickNode URL here.
   */
  chain: {
    rpcUrl: process.env.BASE_RPC_URL ?? 'https://mainnet.base.org',
    usdc: (process.env.USDC_ADDRESS ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913').toLowerCase(),
    chainId: num('BASE_CHAIN_ID', 8453),
    /** How long a balance read is reused. Base blocks are about 2s. */
    cacheMs: num('BALANCE_CACHE_MS', 5_000),
    /**
     * Base's public RPC refuses an eth_getLogs range over 10,000 blocks, so
     * scans are chunked below it. A paid endpoint usually allows far more.
     */
    logChunk: num('LOG_CHUNK_BLOCKS', 9_500),
    /**
     * How far back a first scan looks: ~28 hours at 2s blocks. Bounded because
     * a new wallet cannot have older deposits, and scanning all of Base to
     * prove it would be thousands of requests.
     */
    firstScanBlocks: num('FIRST_SCAN_BLOCKS', 50_000),
    /** Chunks per sync, so one request cannot run for minutes. */
    maxChunksPerSync: num('MAX_CHUNKS_PER_SYNC', 8),

    /**
     * The account that pays gas so nobody else has to.
     *
     * Withdrawals use EIP-3009: the person signs an authorisation off-chain,
     * costing them nothing and requiring no ETH, and this key submits it and
     * pays. It therefore needs a small ETH balance on Base and no USDC — it
     * never holds anyone's money, it only relays.
     *
     * Server-side only. It must never be prefixed EXPO_PUBLIC_, which would
     * inline it into the app bundle for anyone to read.
     */
    gasWalletKey: normaliseKey(process.env.GAS_WALLET_PRIVATE_KEY),

    /** Refuse to relay below this, since a stuck relayer strands withdrawals. */
    minGasWalletEth: num('MIN_GAS_WALLET_ETH', 0.0002),
  },

  /**
   * Naira conversion. The default provider is free and needs no key; rates
   * move slowly enough that an hour of cache costs nothing in accuracy.
   */
  rates: {
    url: process.env.FX_RATE_URL ?? 'https://open.er-api.com/v6/latest/USD',
    cacheMs: num('FX_CACHE_MS', 60 * 60 * 1000),
  },

  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  /** Vision model for the relevance check. */
  visionModel: process.env.VISION_MODEL ?? 'claude-sonnet-5',

  media: {
    maxBytes: num('MAX_UPLOAD_BYTES', 40 * 1024 * 1024),
    maxPhotos: num('MAX_PHOTOS', 5),
    maxVideoSeconds: num('MAX_VIDEO_SECONDS', 30),
    /** Below this a clip is too short to show anything. */
    minVideoSeconds: num('MIN_VIDEO_SECONDS', 2),
  },

  /**
   * Laplacian variance, measured on a 640px-wide greyscale copy so the number
   * means the same thing regardless of what the camera produced.
   *
   * Higher is sharper. A crisp photo lands in the hundreds; a smeared one in
   * the low tens. The gap between `retake` and `warn` is deliberately wide —
   * anything in between is judged by a person, not by this number.
   */
  sharpness: {
    retakeBelow: num('SHARPNESS_RETAKE_BELOW', 40),
    warnBelow: num('SHARPNESS_WARN_BELOW', 90),
  },

  /** Mean luma, 0–255, on the same greyscale copy. */
  exposure: {
    darkRetakeBelow: num('EXPOSURE_DARK_RETAKE_BELOW', 22),
    darkWarnBelow: num('EXPOSURE_DARK_WARN_BELOW', 45),
    brightWarnAbove: num('EXPOSURE_BRIGHT_WARN_ABOVE', 225),
    /** Fraction of pixels pinned at pure black or pure white. */
    clippedWarnAbove: num('EXPOSURE_CLIPPED_WARN_ABOVE', 0.45),
  },

  /**
   * How far the phone may be from the pin before it is worth mentioning.
   *
   * Never a rejection. Consumer GPS is routinely 20–50m out, worse between tall
   * buildings, and a market or a mall is far larger than the single point that
   * represents it. This produces a line of text for the asker, nothing more.
   */
  geo: {
    nearMetres: num('GEO_NEAR_METRES', 150),
    farMetres: num('GEO_FAR_METRES', 600),
  },

  /** Frames sampled from a clip for the sharpness and relevance checks. */
  video: { framesSampled: num('VIDEO_FRAMES_SAMPLED', 3) },

  /** Retakes allowed before the job is handed back to the pool. */
  maxAttempts: num('MAX_SUBMISSION_ATTEMPTS', 3),
} as const;

export const hasDatabase = () => config.databaseUrl.length > 0;
export const hasPrivy = () =>
  config.privy.appId.length > 0 && config.privy.appSecret.length > 0;
export const hasVision = () => config.anthropicKey.length > 0;
export const hasAdmin = () => config.admin.passwordHash.length > 0;
export const hasGasWallet = () => /^0x[0-9a-fA-F]{64}$/.test(config.chain.gasWalletKey);
