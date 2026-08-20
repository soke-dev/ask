import React, { useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useThemeMode } from '@/contexts/ThemeContext';
import { font, text } from '@/constants/type';
import { useApp } from '@/contexts/AppContext';
import { useEmailLogin, privyConfigured } from '@/utils/privy';

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

/**
 * The whole pitch in two lines: what the AI does, then what people do. Stated
 * as capabilities rather than caveats — "answers when it can" led with the
 * limitation, which is a strange thing to put on a sign-in screen.
 */
const FACTS: { icon: keyof typeof Ionicons.glyphMap; line: string }[] = [
  { icon: 'flash', line: 'AI powered answers in seconds.' },
  { icon: 'walk', line: 'Real people verify what AI cannot.' },
];

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { mode, setMode } = useThemeMode();
  const { signIn } = useApp();
  const { sendCode, loginWithCode, state, error } = useEmailLogin();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const inputRef = useRef<TextInput>(null);
  const codeRef = useRef<TextInput>(null);

  /**
   * The code step is driven by Privy's own flow state, not by a local flag.
   * A local `sent` boolean would drift out of step with the SDK — a resend, a
   * failure, or a restored session would leave the screen showing a stage the
   * SDK is no longer in.
   */
  const awaitingCode = state === 'awaiting-code' || state === 'submitting';
  const busy = state === 'sending' || state === 'submitting';

  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(20)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(rise, { toValue: 0, tension: 58, friction: 10, useNativeDriver: true }),
    ]).start();
  }, [fade, rise]);

  const valid = isValidEmail(email);
  const codeValid = /^\d{6}$/.test(code);

  async function handleContinue() {
    if (!valid || busy) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Without Privy configured there is nothing to send a code with. Falling
    // through to the local session keeps the rest of the app reachable, and
    // the screen says so rather than pretending an email went out.
    if (!privyConfigured) {
      signIn(email.trim().toLowerCase());
      return;
    }

    try {
      await sendCode(email.trim().toLowerCase());
      codeRef.current?.focus();
    } catch {
      // useEmailLogin surfaces the reason through `error`.
    }
  }

  async function handleVerify() {
    if (!codeValid || busy) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await loginWithCode(code);
      // Privy owns the session now; this mirrors it into app state so the
      // rest of the screens keep working off one source.
      signIn(email.trim().toLowerCase());
    } catch {
      setCode('');
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: (Platform.OS === 'web' ? 26 : insets.top) + 26,
            paddingBottom: (Platform.OS === 'web' ? 28 : insets.bottom) + 28,
          },
        ]}
      >
        <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }] }}>
          {/* ── Masthead ───────────────────────────────────────────── */}
          <View style={styles.masthead}>
            <Text style={[styles.wordmark, { color: colors.foreground }]}>
              ASK
              <Text style={{ fontFamily: font.sans, color: colors.mutedForeground }}>
                {' '}
                NEARBY
              </Text>
            </Text>

            <Pressable
              onPress={() => setMode(colors.isDark ? 'light' : 'dark')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={colors.isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              style={({ pressed }) => [
                styles.themeBtn,
                { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons
                name={colors.isDark ? 'sunny-outline' : 'moon-outline'}
                size={16}
                color={colors.mutedForeground}
              />
            </Pressable>
          </View>

          <Text style={[styles.headline, { color: colors.foreground }]}>
            Real answers from{'\n'}people who are{'\n'}
            <Text style={{ color: colors.accent }}>actually there.</Text>
          </Text>

          {/* ── How it works ───────────────────────────────────────── */}
          <View style={styles.facts}>
            {FACTS.map((f) => (
              <View key={f.line} style={styles.factRow}>
                <View style={[styles.plate, { borderColor: colors.accent }]}>
                  <Ionicons name={f.icon} size={15} color={colors.accent} />
                </View>
                <Text style={[text.body, { color: colors.mutedForeground, flex: 1 }]}>
                  {f.line}
                </Text>
              </View>
            ))}
          </View>

          {/* ── Sign in ────────────────────────────────────────────── */}
          <View style={styles.form}>
            <Text style={[text.label, { color: colors.faintForeground }]}>Your email</Text>
            <View
              style={[
                styles.field,
                {
                  backgroundColor: colors.surface,
                  borderColor: valid ? colors.primary : colors.borderStrong,
                },
              ]}
            >
              <TextInput
                ref={inputRef}
                style={[styles.input, { color: colors.foreground }]}
                placeholder="you@example.com"
                placeholderTextColor={colors.faintForeground}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleContinue}
              />
              {valid && <Ionicons name="checkmark-circle" size={19} color={colors.primary} />}
            </View>

            {/* The six digits Privy just emailed. Shown only once the code is
                genuinely on its way, so the field never appears empty and
                unexplained. */}
            {awaitingCode && (
              <>
                <Text style={[text.label, { color: colors.faintForeground, marginTop: 16 }]}>
                  Six-digit code
                </Text>
                <View
                  style={[
                    styles.field,
                    {
                      backgroundColor: colors.surface,
                      borderColor: codeValid ? colors.primary : colors.borderStrong,
                    },
                  ]}
                >
                  <TextInput
                    ref={codeRef}
                    style={[styles.input, { color: colors.foreground, letterSpacing: 6 }]}
                    placeholder="000000"
                    placeholderTextColor={colors.faintForeground}
                    value={code}
                    onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    returnKeyType="go"
                    onSubmitEditing={handleVerify}
                  />
                  {codeValid && (
                    <Ionicons name="checkmark-circle" size={19} color={colors.primary} />
                  )}
                </View>
                <Text style={[text.data, { color: colors.faintForeground }]}>
                  Sent to {email}.{' '}
                  <Text style={{ color: colors.accent }} onPress={handleContinue}>
                    Send again
                  </Text>
                </Text>
              </>
            )}

            {error && (
              <View style={[styles.errorRow, { borderColor: colors.danger }]}>
                <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
                <Text style={[text.bodySmall, { color: colors.danger, flex: 1 }]}>{error}</Text>
              </View>
            )}

            <Pressable
              onPress={awaitingCode ? handleVerify : handleContinue}
              disabled={busy || (awaitingCode ? !codeValid : !valid)}
              style={({ pressed }) => [
                styles.continueBtn,
                {
                  backgroundColor: (awaitingCode ? codeValid : valid)
                    ? colors.accent
                    : colors.sunken,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}
            >
              <Text
                style={[
                  text.action,
                  {
                    color: (awaitingCode ? codeValid : valid)
                      ? colors.accentForeground
                      : colors.faintForeground,
                  },
                ]}
              >
                {state === 'sending'
                  ? 'Sending code'
                  : state === 'submitting'
                    ? 'Checking'
                    : awaitingCode
                      ? 'Sign in'
                      : 'Continue'}
              </Text>
              {!busy && (
                <Ionicons
                  name="arrow-forward"
                  size={16}
                  color={
                    (awaitingCode ? codeValid : valid)
                      ? colors.accentForeground
                      : colors.faintForeground
                  }
                />
              )}
            </Pressable>

            <Text style={[text.bodySmall, { color: colors.faintForeground }]}>
              {privyConfigured
                ? 'We email you a code — no password to forget. One account asks and earns.'
                : 'No sign-in service is configured in this build, so this goes straight in.'}
            </Text>
          </View>

          <Text style={[text.data, styles.terms, { color: colors.faintForeground }]}>
            By continuing you agree to our Terms and Privacy Policy.
          </Text>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // No justifyContent:'center' here. Centring a content container that can
  // outgrow the viewport clips the top of the headline beyond reach.
  scroll: { paddingHorizontal: 24, flexGrow: 1 },

  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  wordmark: { fontFamily: font.sansBold, fontSize: 19, letterSpacing: 1.2 },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderWidth: 2,
    borderRadius: 2,
    padding: 11,
  },
  themeBtn: {
    width: 34,
    height: 34,
    borderWidth: 2,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headline: {
    fontFamily: font.sansBold,
    fontSize: 33,
    lineHeight: 36,
    letterSpacing: -0.2,
    textTransform: 'uppercase',
  },

  facts: { marginTop: 26, gap: 12 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  plate: {
    width: 30,
    height: 30,
    borderWidth: 2,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  form: { marginTop: 32, gap: 10 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 15,
    paddingVertical: 14,
  },
  input: { flex: 1, fontFamily: font.sans, fontSize: 16 },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 2,
    paddingVertical: 16,
    marginTop: 4,
  },

  terms: { marginTop: 28, lineHeight: 17 },
});
