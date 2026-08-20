/**
 * Crypto polyfills, imported before anything else.
 *
 * Privy's SDK signs and verifies with WebCrypto, which React Native's JS
 * runtime does not ship. These must land before any Privy code evaluates —
 * the SDK captures `crypto` at module scope, so an import ordered after it
 * would patch a global nobody reads again.
 *
 * Side-effect imports, so ordering is the whole point; leave them at the top.
 */
import 'react-native-get-random-values';
import 'fast-text-encoding';
import '@ethersproject/shims';

import React, { useEffect, type PropsWithChildren } from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { WelcomeSheet } from '@/components/WelcomeSheet';
import {
  Barlow_400Regular,
  Barlow_500Medium,
  Barlow_600SemiBold,
  Barlow_700Bold,
} from '@expo-google-fonts/barlow';
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
  IBMPlexMono_700Bold,
} from '@expo-google-fonts/ibm-plex-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColors } from '@/hooks/useColors';
import { AppProvider, useApp } from '@/contexts/AppContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/components/AuthProvider';
import { AccountSync } from '@/components/AccountSync';
import { useAuth } from '@/utils/privy';
import SignInScreen from './signin';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

/**
 * Ask Nearby is a phone app, so on a desktop browser we sit it in a centred,
 * phone-width frame rather than letting it stretch the full window. Done in
 * React Native rather than in an `app/+html.tsx` shell because that shell is
 * only honoured under static rendering — this works in dev and in export.
 *
 * Native platforms pass straight through.
 */
function PhoneFrame({ children }: PropsWithChildren) {
  const colors = useColors();
  const { width, height } = useWindowDimensions();

  const framed = Platform.OS === 'web' && width >= 480;

  if (!framed) {
    return <View style={[styles.fill, { backgroundColor: colors.background }]}>{children}</View>;
  }

  return (
    <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
      <View
        style={[
          styles.frame,
          {
            backgroundColor: colors.background,
            borderColor: colors.borderStrong,
            height: Math.min(height - 48, 900),
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

/** First frame, before the fonts are registered. Themed, not blank. */
function BootScreen() {
  const colors = useColors();

  return (
    <View style={[styles.boot, { backgroundColor: colors.background }]}>
      <Text style={[styles.bootMark, { color: colors.foreground }]}>
        ASK<Text style={{ color: colors.mutedForeground }}> NEARBY</Text>
      </Text>
      <View style={[styles.bootRule, { backgroundColor: colors.accent }]} />
    </View>
  );
}

function RootLayoutNav() {
  const { user } = useApp();
  const { ready, user: privyUser } = useAuth();
  const colors = useColors();

  /**
   * Waits for Privy before deciding anyone is signed out.
   *
   * Privy restores its session from secure storage asynchronously, and app
   * state only learns about it once AccountSync runs. Checking `isSignedIn`
   * alone meant every refresh rendered the sign-in screen first and snapped to
   * the app a moment later — the person had not been signed out, we simply had
   * not finished asking.
   */
  if (!ready) return <BootScreen />;

  // Privy is the authority here: `user` is our mirror of it and lags by a
  // render, which is exactly the gap that caused the flash.
  if (!privyUser && !user?.isSignedIn) {
    return <SignInScreen />;
  }

  return (
    <>
      {/* Sits outside the Stack so it floats over whatever is showing, and so
          it survives navigation while it is open. */}
      <WelcomeSheet />
      <Stack
        screenOptions={{
          headerBackTitle: 'Back',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="tracking/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="task/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="verify-identity" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="my-questions" options={{ headerShown: false }} />
        <Stack.Screen name="my-jobs" options={{ headerShown: false }} />
        <Stack.Screen name="history" options={{ headerShown: false }} />
        <Stack.Screen name="activity" options={{ headerShown: false }} />
        <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
        <Stack.Screen name="alerts" options={{ headerShown: false }} />
        <Stack.Screen name="privacy" options={{ headerShown: false }} />
        <Stack.Screen name="help" options={{ headerShown: false }} />
        <Stack.Screen name="about" options={{ headerShown: false }} />
        <Stack.Screen name="disputes" options={{ headerShown: false }} />
        <Stack.Screen name="admin" options={{ headerShown: false }} />
        <Stack.Screen name="signin" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
    IBMPlexMono_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Returning null here would flash the host's white default before the
  // first painted frame. Paint the board's own ground instead. The custom
  // families are not registered yet, so this screen deliberately uses the
  // system face with signage tracking rather than referencing our tokens.
  if (!fontsLoaded && !fontError) return <BootScreen />;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={styles.fill}>
            <KeyboardProvider>
              <ThemeProvider>
                <AuthProvider>
                  <AppProvider>
                    {/* Inside AppProvider: it writes what the server knows
                        into app state. Renders nothing. */}
                    <AccountSync />
                    <PhoneFrame>
                      <RootLayoutNav />
                    </PhoneFrame>
                  </AppProvider>
                </AuthProvider>
              </ThemeProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  bootMark: { fontSize: 19, fontWeight: '700', letterSpacing: 1.2 },
  bootRule: { width: 46, height: 2 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
