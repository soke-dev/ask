/**
 * The reviewer's own wallet, connected at the review desk.
 *
 * Disputes are settled by a signature from the arbiter address recorded in the
 * contract. Holding that key on the server would mean a server compromise
 * could rule on every dispute; connecting a wallet in the browser instead
 * keeps it with the person doing the reviewing, and the server never sees it.
 *
 * Talks to the injected EIP-1193 provider directly rather than through wagmi
 * or RainbowKit — those assume a React DOM tree, and this page renders through
 * React Native Web.
 */

export const ESCROW_ADDRESS = (process.env.EXPO_PUBLIC_ESCROW_ADDRESS ?? '').toLowerCase();

/** Base mainnet, as the hex chain id a wallet expects. */
const BASE_CHAIN_ID = '0x2105'; // 8453

const BASE_PARAMS = {
  chainId: BASE_CHAIN_ID,
  chainName: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.base.org'],
  blockExplorerUrls: ['https://basescan.org'],
};

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
};

function provider(): Eip1193 | null {
  if (typeof window === 'undefined') return null;
  const injected = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  return injected ?? null;
}

export const walletAvailable = (): boolean => provider() !== null;

export type ConnectResult =
  | { ok: true; address: string }
  | { ok: false; detail: string };

/**
 * Asks for an account and makes sure it is on Base.
 *
 * The network check is not a formality: a wallet pointed at Ethereum would
 * send a resolution to an address that holds nothing on that chain, and the
 * transaction would either fail or, worse, succeed against something else.
 */
export async function connectWallet(): Promise<ConnectResult> {
  const eth = provider();
  if (!eth) {
    return {
      ok: false,
      detail: 'No wallet found in this browser. Install MetaMask or another wallet extension.',
    };
  }

  try {
    const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
    const address = accounts?.[0];
    if (!address) return { ok: false, detail: 'No account was shared.' };

    const chainId = (await eth.request({ method: 'eth_chainId' })) as string;
    if (chainId !== BASE_CHAIN_ID) {
      const switched = await switchToBase();
      if (!switched.ok) return switched;
    }

    return { ok: true, address: address.toLowerCase() };
  } catch (error) {
    return { ok: false, detail: readable(error) };
  }
}

async function switchToBase(): Promise<ConnectResult> {
  const eth = provider();
  if (!eth) return { ok: false, detail: 'No wallet.' };

  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_ID }] });
    return { ok: true, address: '' };
  } catch (error) {
    // 4902 means the wallet does not know Base yet, which is offering to add
    // it rather than an error worth reporting.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 4902) {
      try {
        await eth.request({ method: 'wallet_addEthereumChain', params: [BASE_PARAMS] });
        return { ok: true, address: '' };
      } catch (addError) {
        return { ok: false, detail: readable(addError) };
      }
    }
    return { ok: false, detail: readable(error) };
  }
}

/** The account already connected, without prompting. */
export async function currentAccount(): Promise<string | null> {
  const eth = provider();
  if (!eth) return null;
  try {
    const accounts = (await eth.request({ method: 'eth_accounts' })) as string[];
    return accounts?.[0]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** Notifies when the person switches account in their wallet. */
export function onAccountChanged(handler: (address: string | null) => void): () => void {
  const eth = provider();
  if (!eth?.on) return () => {};

  const listener = (...args: never[]) => {
    const accounts = args[0] as unknown as string[] | undefined;
    handler(accounts?.[0]?.toLowerCase() ?? null);
  };
  eth.on('accountsChanged', listener);
  return () => eth.removeListener?.('accountsChanged', listener);
}

/**
 * `resolve(bytes32 jobId, bool askerWins)`.
 *
 * Hand-encoded rather than pulled through an ABI library: it is one function
 * with two fixed-size arguments, and the four-byte selector plus two 32-byte
 * words is less code than the dependency would be.
 */
// Taken from the compiled artifact's methodIdentifiers, not written by hand.
// A wrong selector calls nothing and reverts without saying why.
const RESOLVE_SELECTOR = '0xa86f9d9e'; // resolve(bytes32,bool)

/**
 * Reads the arbiter straight from the contract.
 *
 * Deliberately not an environment variable. The owner can call setArbiter at
 * any time, and a var set at build time would then tell a legitimate reviewer
 * they are not the arbiter — or worse, tell the wrong one that they are. The
 * contract is the only thing that decides whose ruling it will accept, so it
 * is the only thing worth asking.
 *
 * Read over the public RPC rather than the injected wallet, so the answer is
 * the same whether or not anybody has connected yet.
 */
const ARBITER_SELECTOR = '0xfe25e00a'; // arbiter()

export async function fetchArbiter(): Promise<string | null> {
  if (!ESCROW_ADDRESS) return null;

  try {
    const response = await fetch('https://mainnet.base.org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: ESCROW_ADDRESS, data: ARBITER_SELECTOR }, 'latest'],
      }),
    });

    const body = (await response.json()) as { result?: string };
    if (!body.result || body.result === '0x') return null;

    // An address comes back right-padded into 32 bytes.
    return `0x${body.result.slice(-40)}`.toLowerCase();
  } catch {
    return null;
  }
}

export type TxResult = { ok: true; txHash: string } | { ok: false; detail: string };

export async function resolveOnChain(
  from: string,
  jobId: string,
  askerWins: boolean,
): Promise<TxResult> {
  const eth = provider();
  if (!eth) return { ok: false, detail: 'No wallet connected.' };
  if (!ESCROW_ADDRESS) return { ok: false, detail: 'No escrow contract configured.' };

  const id = jobId.replace(/^0x/, '').padStart(64, '0');
  const flag = (askerWins ? '1' : '0').padStart(64, '0');
  const data = `${RESOLVE_SELECTOR}${id}${flag}`;

  try {
    const txHash = (await eth.request({
      method: 'eth_sendTransaction',
      params: [{ from, to: ESCROW_ADDRESS, data }],
    })) as string;
    return { ok: true, txHash };
  } catch (error) {
    return { ok: false, detail: readable(error) };
  }
}

function readable(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const e = error as { code?: number; message?: string };
    // 4001 is the person declining in their wallet, which is a choice rather
    // than a failure and should not be dressed up as one.
    if (e.code === 4001) return 'Cancelled in your wallet.';
    if (e.message) return e.message;
  }
  return 'Something went wrong talking to the wallet.';
}

export const shortAddress = (address: string): string =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
