import { keccak256 } from 'viem';

/**
 * Committing to evidence in a way somebody else can check.
 *
 * The contract stores an evidenceHash per claim and emits it in Claimed(), so
 * the chain carries a permanent statement about what was delivered. That is
 * only worth anything if the hash is of the delivered bytes: hash an
 * identifier instead and the commitment holds no matter what the file is
 * later replaced with, which is precisely the thing it exists to prevent.
 *
 * keccak256 rather than sha256 because it is what the contract and every tool
 * around it already speak. A verifier's evidence can be fetched, hashed with
 * any Ethereum library, and compared to Base directly — no endpoint of ours in
 * the path, which is the point.
 */

/** The hash of one file, exactly as the chain would see it. */
export function hashFile(bytes: Buffer): `0x${string}` {
  return keccak256(new Uint8Array(bytes));
}

/**
 * One hash for a submission of several files.
 *
 * A hash of the concatenated file hashes rather than of the concatenated
 * files: the parts stay individually checkable, so somebody disputing one
 * photograph out of three can prove which one they mean.
 *
 * Sorted before combining. The order files arrive in is an accident of the
 * upload, and a commitment that changes when two identical submissions happen
 * to be enumerated differently is not a commitment to anything.
 */
export function combineHashes(hashes: string[]): `0x${string}` | null {
  const clean = hashes.filter((h): h is string => typeof h === 'string' && h.startsWith('0x'));
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0] as `0x${string}`;

  const sorted = [...clean].sort();
  const joined = sorted.map((h) => h.slice(2)).join('');
  return keccak256(`0x${joined}` as `0x${string}`);
}
