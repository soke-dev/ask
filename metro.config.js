const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * Let native builds fall back to a package's "browser" export.
 *
 * Expo resolves native imports with the condition list ["react-native"] only.
 * Packages that predate that condition — jose, which Privy's SDK core depends
 * on for JWTs — publish "browser" and "import" instead. With no match, Metro
 * takes "import", which is the Node build, and the bundle dies on `Unable to
 * resolve module crypto` because React Native has no Node core modules.
 *
 * "react-native" stays first so anything shipping a real React Native build
 * still gets it; "browser" only catches what would otherwise fall through to
 * the Node entry. The browser builds use WebCrypto, which the polyfills
 * imported at the top of app/_layout.tsx provide.
 */
config.resolver.unstable_conditionsByPlatform = {
  ...config.resolver.unstable_conditionsByPlatform,
  ios: ['react-native', 'browser'],
  android: ['react-native', 'browser'],
};

module.exports = config;
