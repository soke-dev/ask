import { useEffect, useRef } from 'react';
import { AREAS, useApp } from '@/contexts/AppContext';
import { useAuth, useEnsureWallet } from '@/utils/privy';
import { API_BASE, apiFetch, hasApi, mediaUrl, setTokenProvider } from '@/utils/api';

/**
 * The link between "Privy says who you are" and "this app has an account".
 *
 * Privy authenticating someone creates nothing on our side — it proves an
 * identity and hands back a token. The row in `users` is created by the first
 * authenticated request, so without this component a person can sign in
 * successfully and still not exist to the backend.
 *
 * Renders nothing. It lives inside AppProvider so it can write what it learns
 * into app state.
 *
 * Everything here is written against one hazard: `useWallets()` returns a new
 * array on most renders, and briefly an empty one while it loads. Anything
 * derived from it changes identity constantly, so effects must key off values
 * that only ever move forward — never object identity, and never a value that
 * can flip back.
 */
type Me = {
  id: string;
  email: string | null;
  wallet: { address: string; chain: string } | null;
  profile: {
    username: string | null;
    name: string | null;
    avatarUrl: string | null;
    homeArea: string | null;
    homeState: string | null;
  };
  identity: { status: string };
  onboarded: boolean;
  preferences: {
    jobsNearby: boolean;
    questionTaken: boolean;
    evidenceBack: boolean;
    payments: boolean;
    reviews: boolean;
    productNews: boolean;
    answersPublicByDefault: boolean;
  };
};

export function AccountSync() {
  const { ready, user, getToken } = useAuth();
  const ensureWallet = useEnsureWallet();
  const {
    signIn,
    updateProfile,
    setHomeArea,
    finishOnboarding,
    setWallet,
    setAccountLoaded,
    refreshIdentity,
    applyPreferences,
    refreshWallet,
  } = useApp();

  const did = user?.did ?? null;
  const email = user?.email ?? null;
  const walletAddress = user?.walletAddress ?? null;

  /**
   * Only unmounting cancels a request.
   *
   * The usual `let cancelled = false` with a cleanup that flips it is wrong
   * here: the cleanup runs on every dependency change, and the dependencies
   * change constantly, so each in-flight /auth/me was discarded before it
   * landed. That is a mounted check, not a cancellation.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Registered once, always calling the current getToken.
   *
   * Re-registering on every change tore the provider down to null before
   * putting it back, and any request reading it inside that window went out
   * with no Authorization header and came back 401.
   */
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  useEffect(() => {
    setTokenProvider(() => getTokenRef.current());
    return () => setTokenProvider(null);
  }, []);

  // Callbacks held in a ref so effects need not depend on their identity.
  const actions = useRef({
    signIn,
    updateProfile,
    setHomeArea,
    finishOnboarding,
    setWallet,
    setAccountLoaded,
    ensureWallet,
    refreshIdentity,
    applyPreferences,
    refreshWallet,
  });
  actions.current = {
    signIn,
    updateProfile,
    setHomeArea,
    finishOnboarding,
    setWallet,
    setAccountLoaded,
    ensureWallet,
    refreshIdentity,
    applyPreferences,
    refreshWallet,
  };

  /** Applies a /auth/me body to app state. */
  function apply(me: Me) {
    const a = actions.current;
    if (me.wallet) a.setWallet({ address: me.wallet.address, chain: 'base' });

    // Only fields the server actually has. Coalescing a null into an empty
    // string is a deletion, not a default.
    const patch: { username?: string; name?: string; avatarUri?: string } = {};
    if (me.profile.username) patch.username = me.profile.username;
    if (me.profile.name) patch.name = me.profile.name;
    // Stored as a relative path; the app needs it absolute to load it.
    const avatar = mediaUrl(me.profile.avatarUrl);
    if (avatar) patch.avatarUri = avatar;
    if (Object.keys(patch).length > 0) a.updateProfile(patch);

    if (me.profile.homeArea) {
      const known = AREAS.find(
        (x) => x.label.toLowerCase() === me.profile.homeArea!.toLowerCase(),
      );
      if (known) a.setHomeArea(known);
    }
    if (me.onboarded) a.finishOnboarding();

    // Seeded, not written back — applyPreferences deliberately does not save,
    // or loading the settings would immediately re-post all of them.
    if (me.preferences) a.applyPreferences(me.preferences);
  }

  /**
   * Signs in and loads the account. Keyed on the DID alone.
   *
   * The key deliberately excludes the wallet. Including it looked reasonable —
   * re-sync once the address exists — but the address flickers to null between
   * renders, so the key alternated and fired a request on every flip. The
   * wallet is handled by its own effect below, which cannot oscillate because
   * it only ever records an address it has not seen before.
   */
  const syncedDid = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !did) {
      syncedDid.current = null;
      return;
    }
    if (syncedDid.current === did) return;
    syncedDid.current = did;

    void (async () => {
      const a = actions.current;
      if (email) a.signIn(email);

      if (!hasApi) {
        a.setAccountLoaded(true);
        return;
      }

      /**
       * Both in flight together, so `accountLoaded` means the profile *and*
       * the identity status are known.
       *
       * Fetching identity after setting accountLoaded left a window where the
       * app believed it had loaded everything while identity was still at its
       * local default of "unverified" — long enough to offer a Verify button
       * to someone whose check was already pending. Running them in parallel
       * closes the gap without costing a second round trip in wall time.
       */
      const [result] = await Promise.all([
        apiFetch<Me>('/auth/me'),
        a.refreshIdentity(),
        a.refreshWallet(),
      ]);
      if (!mounted.current) return;

      if (!result.ok) {
        console.warn(
          `[AccountSync] signed in, but the account service is unreachable — ` +
            `${result.detail}. API_BASE is ${API_BASE || '(unset)'}.`,
        );
        // Allow one retry on a later render rather than pinning the failure.
        syncedDid.current = null;
        a.setAccountLoaded(true);
        return;
      }

      apply(result.data);
      a.setAccountLoaded(true);

      // Slow, and nothing above depends on it.
      if (!user?.walletAddress) {
        try {
          await a.ensureWallet();
        } catch (cause) {
          console.warn('[AccountSync] embedded wallet not created —', cause);
        }
      }
    })();
    // `email` and the wallet are read through refs or checked inside, so they
    // are deliberately not dependencies — including them reintroduces the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, did]);

  /**
   * Records a newly created wallet, once per address.
   *
   * Guarded on the address itself rather than on a boolean, so the flicker to
   * null between renders is simply ignored: an address already reported is
   * never reported again.
   */
  const reportedWallet = useRef<string | null>(null);

  useEffect(() => {
    if (!walletAddress || reportedWallet.current === walletAddress) return;
    reportedWallet.current = walletAddress;

    actions.current.setWallet({ address: walletAddress, chain: 'base' });

    // One more /auth/me so the server's upsert backfills the address.
    if (!hasApi) return;
    void (async () => {
      const result = await apiFetch<Me>('/auth/me');
      if (mounted.current && result.ok) apply(result.data);
    })();
  }, [walletAddress]);

  return null;
}
