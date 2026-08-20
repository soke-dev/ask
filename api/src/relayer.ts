import { createPublicClient, createWalletClient, http, parseUnits, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { config, hasGasWallet } from './config.js';

/**
 * Gasless USDC withdrawals, via EIP-3009.
 *
 * The person's embedded wallet holds USDC but no ETH, so it cannot pay for its
 * own transaction. Rather than sending them ETH first — two transactions, and
 * dust left behind every time — they sign a `TransferWithAuthorization` message
 * off-chain, which costs nothing and needs no balance. This module submits that
 * signature and pays the fee.
 *
 * The relayer never takes custody. The authorisation names the recipient and
 * the amount, both signed by the owner, so the only thing this key can do is
 * broadcast a transfer the owner already approved — it cannot redirect it,
 * change the amount, or move funds on its own.
 */

const USDC_ABI = [
  {
    name: 'transferWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'authorizationState',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

const publicClient = createPublicClient({ chain: base, transport: http(config.chain.rpcUrl) });

function relayer() {
  if (!hasGasWallet()) {
    throw new Error('GAS_WALLET_PRIVATE_KEY is not set — withdrawals cannot be relayed');
  }
  const account = privateKeyToAccount(config.chain.gasWalletKey as `0x${string}`);
  return {
    account,
    wallet: createWalletClient({ account, chain: base, transport: http(config.chain.rpcUrl) }),
  };
}

/** The EIP-712 payload the app asks the owner to sign. */
export function authorizationPayload(input: {
  from: string;
  to: string;
  usdc: number;
  nonce: `0x${string}`;
  validBefore: number;
}) {
  return {
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId: config.chain.chainId,
      verifyingContract: config.chain.usdc,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization' as const,
    message: {
      from: input.from,
      to: input.to,
      value: parseUnits(String(input.usdc), 6).toString(),
      validAfter: '0',
      validBefore: String(input.validBefore),
      nonce: input.nonce,
    },
  };
}

export type RelayResult = { txHash: string; gasEth: string };

export async function relayWithdrawal(input: {
  from: string;
  to: string;
  usdc: number;
  validBefore: number;
  nonce: `0x${string}`;
  signature: `0x${string}`;
}): Promise<RelayResult> {
  const { account, wallet } = relayer();

  // A relayer without gas fails at broadcast anyway; checking first turns an
  // opaque RPC error into something a person can act on.
  const gasBalance = await publicClient.getBalance({ address: account.address });
  if (Number(formatEther(gasBalance)) < config.chain.minGasWalletEth) {
    throw new Error(
      `The gas wallet is out of ETH (${formatEther(gasBalance)} on Base). Top it up to relay withdrawals.`,
    );
  }

  /**
   * Nonces here are random 32-byte values, not sequential, and the contract
   * records each one as used. Checking first means a replayed authorisation is
   * rejected before it costs us a failed transaction's gas.
   */
  const used = await publicClient.readContract({
    address: config.chain.usdc as `0x${string}`,
    abi: USDC_ABI,
    functionName: 'authorizationState',
    args: [input.from as `0x${string}`, input.nonce],
  });
  if (used) throw new Error('This authorisation has already been used.');

  // Split the 65-byte signature into the v, r, s the contract expects.
  const sig = input.signature.slice(2);
  const r = `0x${sig.slice(0, 64)}` as `0x${string}`;
  const s = `0x${sig.slice(64, 128)}` as `0x${string}`;
  let v = parseInt(sig.slice(128, 130), 16);
  // Some signers return 0/1 where the contract wants 27/28.
  if (v < 27) v += 27;

  const args = [
    input.from as `0x${string}`,
    input.to as `0x${string}`,
    parseUnits(String(input.usdc), 6),
    0n,
    BigInt(input.validBefore),
    input.nonce,
    v,
    r,
    s,
  ] as const;

  /**
   * Simulated before broadcast.
   *
   * A bad signature, an expired window or an insufficient balance all revert.
   * Simulating first surfaces the reason as a readable error instead of us
   * paying gas for a transaction that was always going to fail.
   */
  const { request } = await publicClient.simulateContract({
    address: config.chain.usdc as `0x${string}`,
    abi: USDC_ABI,
    functionName: 'transferWithAuthorization',
    args,
    account,
  });

  const txHash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });

  if (receipt.status !== 'success') {
    throw new Error(`The transfer reverted on chain (${txHash}).`);
  }

  return {
    txHash,
    gasEth: formatEther(receipt.gasUsed * receipt.effectiveGasPrice),
  };
}

/** For the health endpoint, so a drained relayer is visible before it bites. */
export async function relayerStatus() {
  if (!hasGasWallet()) return { configured: false as const };
  try {
    const { account } = relayer();
    const balance = await publicClient.getBalance({ address: account.address });
    const eth = Number(formatEther(balance));
    return {
      configured: true as const,
      address: account.address,
      eth: formatEther(balance),
      fundedForRelaying: eth >= config.chain.minGasWalletEth,
    };
  } catch (error) {
    return {
      configured: true as const,
      error: error instanceof Error ? error.message : 'unreadable',
    };
  }
}
