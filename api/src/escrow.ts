import { randomBytes } from 'node:crypto';
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  formatEther,
  http,
  keccak256,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { config, hasEscrow, hasGasWallet } from './config.js';

/**
 * The bridge between a question in Postgres and a job in the escrow contract.
 *
 * Every write here is relayed: the person signs, this submits and pays. That
 * is what lets an embedded wallet holding only USDC take part at all — it has
 * no ETH, and the alternative is sending everyone gas money first.
 *
 * The relayer can broadcast only what was signed. Amounts, recipients and job
 * ids are all inside the signatures, so a compromised server can refuse to
 * relay but cannot redirect a single cent.
 */

const ESCROW_ABI = [
  {
    name: 'fund',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'bytes32' },
      { name: 'asker', type: 'address' },
      { name: 'amount', type: 'uint128' },
      { name: 'deadline', type: 'uint64' },
      { name: 'salt', type: 'bytes32' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'bytes32' },
      { name: 'verifier', type: 'address' },
      { name: 'evidenceHash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'release',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'refundExpired',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'resolve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'bytes32' },
      { name: 'askerWins', type: 'bool' },
    ],
    outputs: [],
  },
  {
    name: 'dispute',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'bytes32' },
      { name: 'raisedBy', type: 'address' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  /**
   * The contract's custom errors.
   *
   * Without them viem cannot decode a revert and prints a bare selector like
   * `0x66ec4ee6` with a link to look it up — which is no use to anybody
   * reading a screen.
   */
  { type: 'error', name: 'JobExists', inputs: [] },
  { type: 'error', name: 'DeadlineInPast', inputs: [] },
  { type: 'error', name: 'DeadlineNotReached', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  { type: 'error', name: 'WrongStatus', inputs: [{ name: 'status', type: 'uint8' }] },
  { type: 'error', name: 'BadSignature', inputs: [] },
  { type: 'error', name: 'NotArbiter', inputs: [] },
  {
    name: 'getJob',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'asker', type: 'address' },
          { name: 'verifier', type: 'address' },
          { name: 'amount', type: 'uint128' },
          { name: 'deadline', type: 'uint64' },
          { name: 'status', type: 'uint8' },
          { name: 'evidenceHash', type: 'bytes32' },
        ],
      },
    ],
  },
] as const;

const publicClient = createPublicClient({ chain: base, transport: http(config.chain.rpcUrl) });

function relayer() {
  if (!hasGasWallet()) throw new Error('GAS_WALLET_PRIVATE_KEY is not set');
  if (!hasEscrow()) throw new Error('ESCROW_ADDRESS is not set');
  const account = privateKeyToAccount(config.chain.gasWalletKey as `0x${string}`);
  return {
    account,
    wallet: createWalletClient({ account, chain: base, transport: http(config.chain.rpcUrl) }),
    escrow: config.chain.escrowAddress as `0x${string}`,
  };
}

/**
 * The account that rules on disputes.
 *
 * Separate from the relayer because the contract insists: resolve() is
 * onlyArbiter, and the relayer is not it. It also pays its own gas, since it
 * sends the transaction rather than forwarding somebody's signature.
 *
 * A dispute resolved on the desk used to update the database and leave the
 * escrow Disputed on chain for ever — the money frozen, the row saying
 * otherwise, and no code anywhere that could have moved it.
 */
export const hasArbiter = () =>
  /^0x[0-9a-fA-F]{64}$/.test(config.chain.arbiterKey) && hasEscrow();

function arbiter() {
  if (!hasArbiter()) throw new Error('ARBITER_PRIVATE_KEY is not set');
  const account = privateKeyToAccount(config.chain.arbiterKey as `0x${string}`);
  return {
    account,
    wallet: createWalletClient({ account, chain: base, transport: http(config.chain.rpcUrl) }),
    escrow: config.chain.escrowAddress as `0x${string}`,
  };
}

/** The address the contract will accept a ruling from. */
export function arbiterAddress(): `0x${string}` | null {
  return hasArbiter()
    ? privateKeyToAccount(config.chain.arbiterKey as `0x${string}`).address
    : null;
}

/**
 * Settles a disputed job on chain: the bounty to the verifier, or back to the
 * asker. Refuses loudly rather than pretending, because a ruling recorded in
 * the database and not on the chain is the state this exists to end.
 */
export async function relayResolve(
  jobId: `0x${string}`,
  askerWins: boolean,
): Promise<{ txHash: string }> {
  const { account, wallet, escrow } = arbiter();

  const { request } = await publicClient.simulateContract({
    address: escrow,
    abi: ESCROW_ABI,
    functionName: 'resolve',
    args: [jobId, askerWins],
    account,
  }).catch((error) => {
    throw readableRevert(error, 'resolve');
  });

  const txHash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}

/**
 * A question's UUID as the contract's bytes32 job id.
 *
 * Hashed rather than padded: a UUID is 16 bytes and a bytes32 is 32, so
 * padding would leave half the word zero and make two ids differing only in
 * their tail collide under any future truncation. keccak also means the id
 * cannot be reversed into anything about the question.
 */
export function jobIdFor(questionId: string): `0x${string}` {
  return keccak256(Buffer.from(questionId.replace(/-/g, ''), 'hex'));
}

/** The EIP-712 domain the contract computes for itself. */
function domain() {
  return {
    name: 'AskEscrow',
    version: '1',
    chainId: config.chain.chainId,
    verifyingContract: config.chain.escrowAddress,
  };
}

/**
 * The USDC authorisation an asker signs to fund a job.
 *
 * The nonce is keccak(jobId, amount, salt), which is what binds the money to
 * this particular job. Without it the signature would say only "move $5 to the
 * escrow contract" and the relayer would choose what it paid for.
 */
export function fundPayload(input: {
  jobId: `0x${string}`;
  asker: string;
  usdc: number;
  validBefore: number;
  salt: `0x${string}`;
}) {
  const amount = parseUnits(String(input.usdc), 6);

  const nonce = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint128' }, { type: 'bytes32' }],
      [input.jobId, amount, input.salt],
    ),
  );

  return {
    nonce,
    typedData: {
      domain: {
        name: 'USD Coin',
        version: '2',
        chainId: config.chain.chainId,
        verifyingContract: config.chain.usdc,
      },
      types: {
        ReceiveWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'ReceiveWithAuthorization' as const,
      message: {
        from: input.asker,
        to: config.chain.escrowAddress,
        value: amount.toString(),
        validAfter: '0',
        validBefore: String(input.validBefore),
        nonce,
      },
    },
  };
}

/** What a verifier signs to record their claim on a job. */
export const claimPayload = (jobId: `0x${string}`, verifier: string, evidenceHash: `0x${string}`) => ({
  domain: domain(),
  types: {
    Claim: [
      { name: 'jobId', type: 'bytes32' },
      { name: 'verifier', type: 'address' },
      { name: 'evidenceHash', type: 'bytes32' },
    ],
  },
  primaryType: 'Claim' as const,
  message: { jobId, verifier, evidenceHash },
});

/** What an asker signs to release payment. */
export const releasePayload = (jobId: `0x${string}`, verifier: string) => ({
  domain: domain(),
  types: {
    Release: [
      { name: 'jobId', type: 'bytes32' },
      { name: 'verifier', type: 'address' },
    ],
  },
  primaryType: 'Release' as const,
  message: { jobId, verifier },
});

/** What either party signs to raise a dispute. */
export const disputePayload = (jobId: `0x${string}`, raisedBy: string) => ({
  domain: domain(),
  types: {
    Dispute: [
      { name: 'jobId', type: 'bytes32' },
      { name: 'raisedBy', type: 'address' },
    ],
  },
  primaryType: 'Dispute' as const,
  message: { jobId, raisedBy },
});

export const randomSalt = (): `0x${string}` => `0x${randomBytes(32).toString('hex')}`;

/** Splits a 65-byte signature the way the token expects it. */
function vrs(signature: string) {
  const sig = signature.replace(/^0x/, '');
  let v = parseInt(sig.slice(128, 130), 16);
  if (v < 27) v += 27; // some signers return 0/1
  return {
    v,
    r: `0x${sig.slice(0, 64)}` as `0x${string}`,
    s: `0x${sig.slice(64, 128)}` as `0x${string}`,
  };
}

async function ensureGas(address: `0x${string}`): Promise<void> {
  const balance = await publicClient.getBalance({ address });
  if (Number(formatEther(balance)) < config.chain.minGasWalletEth) {
    throw new Error(
      `The gas wallet is out of ETH (${formatEther(balance)} on Base). Top it up to relay.`,
    );
  }
}

/**
 * Simulates, then broadcasts, then waits.
 *
 * Simulating first turns a revert into a readable message instead of a failed
 * transaction we paid for — and reverts here are common and meaningful: an
 * expired authorisation, a job already funded, a deadline in the past.
 */
/**
 * Turns a chain revert into a sentence.
 *
 * viem's errors carry the full call — every argument, the ABI signature, a
 * docs link — which is exactly right for a developer and useless in front of
 * somebody trying to send ₦500. The underlying reason is one line inside it.
 */
function readableRevert(error: unknown, functionName: string): Error {
  const raw = error instanceof Error ? error.message : String(error);

  /**
   * Matched against the reason, never the whole message.
   *
   * The message contains the function name, so a pattern like /expired/ hit
   * `refundExpired` itself and reported "that authorisation expired" for a
   * revert that actually said the deadline had not been reached — the opposite
   * of the truth, on a question about somebody's money.
   */
  const reasonLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(
      (line) =>
        line.length > 0 &&
        !/^(The contract function|Contract Call|address|function|args|sender|Docs|Details|Version|Make sure|You can look|Unable to decode)/i.test(
          line,
        ),
    ) ?? '';

  const reasons: [RegExp, string][] = [
    [/transfer amount exceeds balance/i, 'Your wallet does not hold enough USDC for this.'],
    [/authorization is used|nonce already/i, 'That authorisation was already used. Start again.'],
    [/authorization is not yet valid|valid after/i, 'That authorisation is not valid yet.'],
    [/expired|valid before/i, 'That authorisation expired. Start again.'],
    [/invalid signature|ECDSA/i, 'The signature did not match. Start again.'],
    [/JobExists/i, 'This job is already funded.'],
    [/DeadlineInPast/i, 'The deadline has already passed.'],
    [/NotFunded|WrongStatus/i, 'This job is not in a state that allows that.'],
    [/insufficient funds for gas/i, 'The relayer is out of gas. This is on us — try shortly.'],
    [/DeadlineNotReached/i, 'The deadline has not passed yet, so this cannot be refunded.'],
  ];

  for (const [pattern, message] of reasons) {
    if (pattern.test(reasonLine)) return new Error(message);
  }

  // Nothing recognised: keep the reason line, drop the call dump. Split on
  // lines rather than a regex with embedded newlines, which is easier to read
  // and cannot be mangled by escaping.
  const reason = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !/^(Contract Call|address|function|args|sender|Docs|Details|Version)/i.test(line));
  return new Error(reason?.trim() || `The ${functionName} step failed on chain.`);
}

async function send(
  functionName: 'fund' | 'claim' | 'release' | 'refundExpired' | 'dispute',
  args: readonly unknown[],
): Promise<{ txHash: string; gasEth: string }> {
  const { account, wallet, escrow } = relayer();
  await ensureGas(account.address);

  let request;
  try {
    ({ request } = await publicClient.simulateContract({
      address: escrow,
      abi: ESCROW_ABI,
      functionName,
      // viem's generics cannot narrow across a union of function names here;
      // the ABI still checks the encoding at runtime.
      args: args as never,
      account,
    }));
  } catch (error) {
    throw readableRevert(error, functionName);
  }

  /**
   * Nonce chosen here, and re-chosen if the node argues.
   *
   * viem defaults to the pending count, and the public Base RPC has been seen
   * returning a pending nonce *lower* than its own latest — 31 against 45 —
   * which is impossible and gets every transaction rejected as "nonce too
   * low". Refunds failed on that alone, with the money sitting in the contract
   * and the error pointing at the chain.
   *
   * Reading from `latest` fixes that but introduces its own lag: the node can
   * still be a block behind immediately after one of these lands, so a run of
   * transactions trips over itself by one. The node states the nonce it wants
   * in the rejection, so take it at its word and go again.
   */
  let txHash: `0x${string}` | null = null;
  let attempt = 0;

  while (txHash === null) {
    const nonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: 'latest',
    });

    try {
      txHash = await wallet.writeContract({ ...request, nonce: nonce + attempt });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Three is enough for a node a block or two behind; beyond that it is
      // not lag and retrying would just resend into a real failure.
      if (!/nonce too low/i.test(message) || attempt >= 3) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });

  if (receipt.status !== 'success') throw new Error(`${functionName} reverted on chain (${txHash})`);

  return { txHash, gasEth: formatEther(receipt.gasUsed * receipt.effectiveGasPrice) };
}

export const relayFund = (input: {
  jobId: `0x${string}`;
  asker: string;
  usdc: number;
  deadline: number;
  salt: `0x${string}`;
  validBefore: number;
  signature: string;
}) => {
  const { v, r, s } = vrs(input.signature);
  return send('fund', [
    input.jobId,
    input.asker,
    parseUnits(String(input.usdc), 6),
    BigInt(input.deadline),
    input.salt,
    0n,
    BigInt(input.validBefore),
    v,
    r,
    s,
  ]);
};

export const relayClaim = (
  jobId: `0x${string}`,
  verifier: string,
  evidenceHash: `0x${string}`,
  signature: string,
) => send('claim', [jobId, verifier, evidenceHash, signature]);

export const relayRelease = (jobId: `0x${string}`, signature: string) =>
  send('release', [jobId, signature]);

export const relayRefund = (jobId: `0x${string}`) => send('refundExpired', [jobId]);

export const relayDispute = (jobId: `0x${string}`, raisedBy: string, signature: string) =>
  send('dispute', [jobId, raisedBy, signature]);

/** Reads a job's on-chain state — the authority when it disagrees with us. */
export async function readJob(jobId: `0x${string}`) {
  if (!hasEscrow()) return null;
  try {
    const job = await publicClient.readContract({
      address: config.chain.escrowAddress as `0x${string}`,
      abi: ESCROW_ABI,
      functionName: 'getJob',
      args: [jobId],
    });
    /**
     * In the contract's order, which is not the obvious one.
     *
     * AskEscrow.Status puts Disputed at 3, before Released and Refunded — a
     * job can be queried straight out of Claimed, so it sits next to it. This
     * list had the happy path first and a seventh state that does not exist,
     * so everything from index 3 up was mislabelled: released jobs read as
     * refunded, refunded ones as disputed, and the one genuinely frozen job as
     * released. It made correctly-settled payments look like money that had
     * come back, which is the most alarming way to be wrong about a ledger.
     *
     * Keep aligned with contracts/src/AskEscrow.sol.
     */
    const statuses = ['none', 'funded', 'claimed', 'disputed', 'released', 'refunded'];
    return {
      asker: job.asker,
      verifier: job.verifier,
      amountUsdc: Number(job.amount) / 1e6,
      deadline: Number(job.deadline),
      status: statuses[job.status] ?? String(job.status),
      evidenceHash: job.evidenceHash,
    };
  } catch {
    return null;
  }
}
