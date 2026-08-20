import { useCallback, useMemo, useState } from 'react';
import {
  usePrivy as usePrivyNative,
  useLoginWithEmail as useLoginWithEmailNative,
  useEmbeddedEthereumWallet,
} from '@privy-io/expo';
import {
  readableAuthError,
  type AuthState,
  type AuthUser,
  type EmailLogin,
  type EmailLoginState,
  type EnsureWallet,
  type SignTypedData,
} from './privyShared';

export * from './privyShared';

/**
 * The device half of the auth split, and the file TypeScript resolves.
 *
 * Metro uses this on iOS and Android and swaps in privy.web.ts on web, so
 * screens import '@/utils/privy' and never name a platform. Both files export
 * the same surface and re-export the shared contract, which is what keeps the
 * single import path honest.
 *
 * `@privy-io/expo` needs expo-secure-store, passkeys and a native extension
 * module, so it only exists in a development build — it cannot run in Expo Go
 * and it cannot run on web.
 */

function mapState(status: string | undefined): EmailLoginState {
  switch (status) {
    case 'sending-code':
      return 'sending';
    case 'awaiting-code-input':
      return 'awaiting-code';
    case 'submitting-code':
      return 'submitting';
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    default:
      return 'initial';
  }
}

export function useAuth(): AuthState & {
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
} {
  const privy = usePrivyNative();
  const { wallets } = useEmbeddedEthereumWallet();

  const mapped = useMemo<AuthUser | null>(() => {
    const user = privy.user;
    if (!user) return null;

    const emailAccount = user.linked_accounts.find(
      (account): account is typeof account & { address: string } =>
        account.type === 'email' && 'address' in account,
    );

    return {
      did: user.id,
      email: emailAccount?.address?.toLowerCase() ?? null,
      walletAddress: wallets[0]?.address?.toLowerCase() ?? null,
    };
  }, [privy.user, wallets]);

  return {
    ready: privy.isReady,
    user: mapped,
    signOut: privy.logout,
    getToken: privy.getAccessToken,
  };
}

export function useEmailLogin(): EmailLogin {
  const { sendCode, loginWithCode, state } = useLoginWithEmailNative();
  const [error, setError] = useState<string | null>(null);
  // The native SDK's loginWithCode takes the address alongside the code.
  const [pendingEmail, setPendingEmail] = useState('');

  const send = useCallback(
    async (email: string) => {
      setError(null);
      setPendingEmail(email);
      try {
        await sendCode({ email });
      } catch (cause) {
        setError(readableAuthError(cause));
        throw cause;
      }
    },
    [sendCode],
  );

  const submit = useCallback(
    async (code: string) => {
      setError(null);
      try {
        await loginWithCode({ code, email: pendingEmail });
      } catch (cause) {
        setError(readableAuthError(cause));
        throw cause;
      }
    },
    [loginWithCode, pendingEmail],
  );

  return {
    sendCode: send,
    loginWithCode: submit,
    state: mapState((state as { status?: string } | undefined)?.status),
    error,
  };
}

export function useEnsureWallet(): EnsureWallet {
  const { wallets, create } = useEmbeddedEthereumWallet();

  return useCallback(async () => {
    if (wallets.length > 0) return;
    // createAdditional stays false: one embedded wallet per account.
    await create();
  }, [wallets, create]);
}

export function useSignAuthorization(): SignTypedData {
  const { wallets } = useEmbeddedEthereumWallet();

  return useCallback(
    async (typedData) => {
      const wallet = wallets[0];
      if (!wallet) throw new Error('No embedded wallet to sign with.');

      // The Expo SDK exposes the provider on the wallet itself, not on the
      // hook, and signs through EIP-1193 rather than a dedicated method — so
      // this is the same request any dapp would make.
      const provider = await wallet.getProvider();
      const signature = (await provider.request({
        method: 'eth_signTypedData_v4',
        params: [wallet.address, JSON.stringify(typedData)],
      })) as string;

      return signature;
    },
    [wallets],
  );
}
