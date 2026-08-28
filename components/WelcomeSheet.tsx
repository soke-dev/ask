import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import { useApp } from '@/contexts/AppContext';
import { AreaPicker, type AreaChoice } from '@/components/AreaPicker';
import { SheetKeyboardView } from '@/components/SheetKeyboardView';
import { VERIFIED_ONLY_ABOVE, formatNaira } from '@/constants/money';
import { apiFetch, hasApi } from '@/utils/api';

/**
 * The first thing a new account sees.
 *
 * It asks for a username and nothing else. A typed-in name proves nothing —
 * anyone can enter anything — so collecting one would only produce a field
 * that looks like identity without being it. The real name comes from the NIN
 * check or not at all.
 *
 * The identity step is second and skippable on purpose. Picking a handle is
 * cheap and gives something back immediately; a government ID is expensive and
 * gives nothing back until it is explained. An identity wall on first launch
 * loses people who would have verified a week later.
 */
type Step = 'username' | 'area' | 'identity';

/** A username has to survive being in a URL and being typed by a stranger. */
function cleanUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '')
    .slice(0, 20);
}

const MIN_USERNAME = 3;

export function WelcomeSheet() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    user,
    profile,
    updateProfile,
    onboarded,
    finishOnboarding,
    identity,
    accountLoaded,
    setHomeArea,
  } = useApp();

  const [step, setStep] = useState<Step>('username');
  // Suggestion, not a stored value: prefer what the server has, fall back to
  // the email local part purely to save typing.
  const [username, setUsername] = useState(() =>
    cleanUsername(profile.username || (user?.email ?? '').split('@')[0] || ''),
  );
  /**
   * Starts empty, never seeded.
   *
   * `homeArea` defaults to Ikeja so the rest of the app has something to
   * filter on, but that is a placeholder rather than a choice. Seeding from it
   * opened this picker already inside Lagos and offered a "Use Ikeja" button
   * to somebody in Kano who had picked nothing at all.
   */
  const [choice, setChoice] = useState<AreaChoice | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const slide = useRef(new Animated.Value(0)).current;

  // Someone who already verified has clearly been through this.
  /**
   * Nothing is shown until the server has answered.
   *
   * `onboarded` starts false locally, so without `accountLoaded` this opened
   * on every launch for people who finished onboarding weeks ago — it closed
   * again once /auth/me returned, but by then they had already been asked.
   */
  const open =
    Boolean(user?.isSignedIn) && accountLoaded && !onboarded && identity.status !== 'verified';

  useEffect(() => {
    if (!open) return;
    Animated.timing(slide, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, slide]);

  // Seeded from the email once the profile lands, unless they have typed.
  useEffect(() => {
    if (!open || username !== '') return;
    const suggestion = profile.username || (user?.email ?? '').split('@')[0] || '';
    if (suggestion) setUsername(cleanUsername(suggestion));
  }, [open, profile.username, user?.email, username]);

  if (!open) return null;

  const handleValid = username.length >= MIN_USERNAME;

  /**
   * Writes the choice to the server, not just to memory.
   *
   * This sheet used to call `finishOnboarding()` alone, which flips a flag
   * that lives only for the session. Nothing recorded that it had ever been
   * answered, so it reappeared on every single launch — and the username went
   * with it, because that was local too.
   *
   * The PATCH also stamps `onboarded_at`, so saving a username and finishing
   * onboarding are one write rather than two that can half-apply.
   */
  async function saveUsername() {
    if (!handleValid || saving) return;
    setSaveError(null);

    if (!hasApi) {
      updateProfile({ username });
      setStep('identity');
      return;
    }

    setSaving(true);
    const result = await apiFetch<{ ok: true }>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ username }),
    });
    setSaving(false);

    if (!result.ok) {
      // A taken username has to stop here, otherwise the sheet closes and the
      // person believes they own a handle that belongs to somebody else.
      setSaveError(
        result.code === 'username_taken'
          ? 'That username is taken. Try another.'
          : `Could not save it — ${result.detail}`,
      );
      return;
    }

    updateProfile({ username });
    setStep('area');
  }

  /**
   * Records where they are, which decides which jobs they are shown.
   *
   * Asked here rather than left to a setting nobody opens: the Earn board
   * filters on it, so somebody who never sets it either sees everything in
   * the country or nothing at all. Changeable later, and said so.
   */
  async function saveArea() {
    if (saving || !choice) return;
    setSaving(true);

    setHomeArea({ key: choice.lga.toLowerCase().replace(/\s+/g, '-'), label: choice.lga, state: choice.state });

    if (hasApi) {
      await apiFetch('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
          homeArea: choice.lga,
          homeState: choice.state,
          homeCountry: choice.country,
        }),
      });
    }

    setSaving(false);
    setStep('identity');
  }

  /** Skipping is an answer too, and has to be remembered like any other. */
  async function dismiss() {
    finishOnboarding();
    if (hasApi) await apiFetch('/auth/onboarded', { method: 'POST' });
  }

  async function verifyNow() {
    await dismiss();
    router.push('/verify-identity');
  }

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [420, 0] });

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={dismiss}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <SheetKeyboardView style={styles.lift}>
          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.background,
                borderColor: colors.borderStrong,
                paddingBottom: insets.bottom + 22,
                transform: [{ translateY }],
              },
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />

            {/*
             * Capped and scrollable, for the reason the withdrawal sheet is:
             * lifting a bottom-anchored sheet clear of the keyboard only helps
             * while it still fits. The username step is tall enough that on a
             * short screen it ran off the top instead, taking the field being
             * typed into with it.
             */}
            <ScrollView
              style={styles.bodyScroll}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >

            {step === 'username' ? (
              <>
                <Text style={[text.label, { color: colors.accent }]}>Welcome</Text>
                <Text style={[text.display, { color: colors.foreground, marginTop: 6 }]}>
                  Pick your username.
                </Text>
                <Text style={[text.body, { color: colors.mutedForeground, marginTop: 8 }]}>
                  This is all anyone sees on your questions, and on jobs you take.
                </Text>

                <View
                  style={[
                    styles.handleRow,
                    { backgroundColor: colors.surface, borderColor: colors.borderStrong },
                  ]}
                >
                  <Text style={[text.dataMedium, { color: colors.faintForeground }]}>@</Text>
                  <TextInput
                    value={username}
                    onChangeText={(v) => setUsername(cleanUsername(v))}
                    placeholder="chidi"
                    placeholderTextColor={colors.faintForeground}
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={saveUsername}
                    style={[styles.handleInput, { color: colors.foreground }]}
                  />
                </View>
                <Text
                  style={[
                    text.data,
                    { color: saveError ? colors.danger : colors.faintForeground, marginTop: 7 },
                  ]}
                >
                  {saveError
                    ? saveError
                    : username.length > 0 && !handleValid
                      ? `At least ${MIN_USERNAME} characters — letters, numbers and _ only.`
                      : 'Suggested from your email. Change it now or later in your profile.'}
                </Text>

                <Pressable
                  onPress={saveUsername}
                  disabled={!handleValid || saving}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    {
                      backgroundColor: handleValid ? colors.primary : colors.sunken,
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      text.action,
                      { color: handleValid ? colors.primaryForeground : colors.faintForeground },
                    ]}
                  >
                    {saving ? 'Saving' : 'Continue'}
                  </Text>
                </Pressable>

                <Pressable onPress={dismiss} style={styles.skip}>
                  <Text style={[text.action, { color: colors.mutedForeground }]}>
                    Not now
                  </Text>
                </Pressable>
              </>
            ) : step === 'area' ? (
              <>
                <Text style={[text.label, { color: colors.accent }]}>Where you are</Text>
                <Text style={[text.display, { color: colors.foreground, marginTop: 6 }]}>
                  Which area?
                </Text>
                {/* Three lines of explanation above a scrolling list left no
                    room to breathe. The picker labels each step itself, so
                    this only has to say why it is being asked. */}
                <Text style={[text.body, { color: colors.mutedForeground, marginTop: 6 }]}>
                  So we can show you jobs nearby. Changeable any time.
                </Text>

                <AreaPicker
                  value={choice}
                  onChange={(picked) => setChoice(picked)}
                />

                <Pressable
                  onPress={saveArea}
                  disabled={saving || !choice}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    {
                      backgroundColor: choice ? colors.primary : colors.sunken,
                      opacity: pressed || saving ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      text.action,
                      { color: choice ? colors.primaryForeground : colors.faintForeground },
                    ]}
                  >
                    {saving ? 'Saving' : choice ? `Use ${choice.lga}` : 'Pick your area'}
                  </Text>
                </Pressable>

                <Pressable onPress={dismiss} style={styles.skip}>
                  <Text style={[text.action, { color: colors.mutedForeground }]}>Not now</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={[styles.badge, { borderColor: colors.primary }]}>
                  <Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} />
                </View>

                <Text style={[text.display, { color: colors.foreground, marginTop: 14 }]}>
                  You are set, @{username}.
                </Text>
                <Text style={[text.body, { color: colors.mutedForeground, marginTop: 8 }]}>
                  One optional thing. Confirming your identity opens up work that is closed
                  otherwise:
                </Text>

                {/* Concrete, checkable reasons. Not "for your security". */}
                <View style={[styles.reasons, { borderColor: colors.border }]}>
                  {[
                    {
                      icon: 'cash-outline' as const,
                      text: `Take jobs paying over ₦${formatNaira(VERIFIED_ONLY_ABOVE)} — those are verified-only`,
                    },
                    {
                      icon: 'trending-up-outline' as const,
                      text: 'Askers can require a verified person, and often do',
                    },
                    {
                      icon: 'people-outline' as const,
                      text: 'A badge on your name, so strangers trust your answers faster',
                    },
                  ].map((reason) => (
                    <View key={reason.text} style={styles.reasonRow}>
                      <Ionicons name={reason.icon} size={15} color={colors.primary} />
                      <Text style={[text.bodySmall, { color: colors.foreground, flex: 1 }]}>
                        {reason.text}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* What it does not do, stated as plainly as what it does. */}
                <Text style={[text.data, { color: colors.faintForeground, marginTop: 12 }]}>
                  Your KYC details are kept private. Only we can see them, never other users.
                  It does not affect how you get paid.
                </Text>

                <Pressable
                  onPress={verifyNow}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
                  ]}
                >
                  <Text style={[text.action, { color: colors.primaryForeground }]}>
                    Verify my identity
                  </Text>
                </Pressable>

                <Pressable onPress={dismiss} style={styles.skip}>
                  <Text style={[text.action, { color: colors.mutedForeground }]}>
                    Skip — I will do this later
                  </Text>
                </Pressable>
              </>
            )}
            </ScrollView>
          </Animated.View>
        </SheetKeyboardView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  lift: { justifyContent: 'flex-end' },
  sheet: {
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    paddingHorizontal: 22,
    paddingTop: 12,
    // Never taller than what the keyboard leaves behind.
    maxHeight: '92%',
  },
  // flexShrink so the scroll view yields to the cap instead of insisting on
  // its content height and defeating it.
  bodyScroll: { flexShrink: 1 },
  body: { paddingBottom: 4 },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 14,
    marginTop: 22,
  },
  handleInput: { flex: 1, paddingVertical: 15, fontFamily: font.mono, fontSize: 17 },
  badge: {
    width: 46,
    height: 46,
    borderWidth: 2,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasons: { borderWidth: 2, borderRadius: 2, padding: 14, gap: 11, marginTop: 16 },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  primaryBtn: { borderRadius: 2, paddingVertical: 15, alignItems: 'center', marginTop: 22 },
  skip: { paddingVertical: 13, alignItems: 'center' },
});
