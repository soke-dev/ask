import React from 'react';
import { PrivyProvider } from '@privy-io/expo';
import { PRIVY_APP_ID, PRIVY_CLIENT_ID, privyConfigured } from '@/utils/privyShared';

/**
 * Wraps the app in Privy on iOS and Android. `AuthProvider.web.tsx` does the
 * same job in a browser.
 *
 * When Privy is not configured the children are rendered without a provider
 * rather than crashing on a missing app ID. Screens then see `ready: true`
 * with no user, which is the truthful description of that state — a build with
 * no auth, not a user who is signed out mid-session.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!privyConfigured) return <>{children}</>;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      clientId={PRIVY_CLIENT_ID}
      config={{
        // Base, and only Base. An embedded wallet created on the wrong chain
        // would hold funds the app cannot reach.
        embedded: {
          ethereum: { createOnLogin: 'users-without-wallets' },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
