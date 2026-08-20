import React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { base } from 'viem/chains';
import { PRIVY_APP_ID, privyConfigured } from '@/utils/privyShared';

/**
 * The browser provider. No client ID here — that is a native-only concept.
 *
 * See AuthProvider.tsx for the device version and for why an unconfigured
 * build renders its children rather than throwing.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!privyConfigured) return <>{children}</>;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email'],
        embeddedWallets: {
          // Anyone who signs in gets a wallet, without a second prompt.
          ethereum: { createOnLogin: 'users-without-wallets' },
          /**
           * Suppresses Privy's own signing modal so our confirmation screen is
           * the only one. Ignored while "enforce wallet UIs" is on in the
           * Privy dashboard — that setting wins, and the result is two
           * confirmations in a row.
           */
          showWalletUIs: false,
        },
        defaultChain: base,
        supportedChains: [base],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
