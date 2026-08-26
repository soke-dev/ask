/**
 * Everything that must exist before any other module is evaluated.
 *
 * These were originally at the top of `app/_layout.tsx`, which looks like the
 * first thing the app runs and is not: `expo-router/entry` builds the route
 * tree and pulls in providers — Privy, and through it `jose` — before a layout
 * file is reached. `jose`'s browser build does `export default crypto` at
 * module scope, so it read the global before anything had created it and died
 * with "Property 'crypto' doesn't exist".
 *
 * Imported from index.js, which runs ahead of the router entry.
 */

// Creates `global.crypto` with getRandomValues if it is missing.
import 'react-native-get-random-values';
// TextEncoder / TextDecoder, which JWT parsing needs.
import 'fast-text-encoding';
// Buffer and the other Node globals ethers-derived code reaches for.
import '@ethersproject/shims';

/**
 * A `CryptoKey` binding, so a bare reference does not throw.
 *
 * `jose` evaluates `key instanceof CryptoKey` at module scope. React Native
 * has no such class, and an undefined identifier in an `instanceof` is a
 * ReferenceError rather than a quiet false — so the module cannot finish
 * loading even when nothing ever calls the function.
 *
 * This is a placeholder that nothing will ever be an instance of, which is the
 * correct answer here: without WebCrypto there are no CryptoKeys to match.
 */
const globals = globalThis as unknown as Record<string, unknown>;

if (typeof globals.CryptoKey === 'undefined') {
  globals.CryptoKey = class CryptoKey {};
}

/**
 * What is deliberately *not* polyfilled: `crypto.subtle`.
 *
 * React Native has no WebCrypto, and faking one would be worse than not having
 * it — a stub that returns plausible bytes for a signature check is a security
 * hole wearing a polyfill's clothes.
 *
 * Privy's email login and the embedded wallet do their signing natively, so
 * this path is not exercised there. Anything that genuinely needs subtle on
 * device wants `react-native-quick-crypto`, which implements it properly.
 */
if (__DEV__ && typeof globals.crypto === 'object' && globals.crypto !== null) {
  const c = globals.crypto as { subtle?: unknown };
  if (!c.subtle) {
    console.log('[polyfills] crypto.getRandomValues ready; crypto.subtle absent by design');
  }
}
