import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
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
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import { useApp } from '@/contexts/AppContext';
import { VERIFIED_ONLY_ABOVE, formatNaira } from '@/constants/money';

function isValidNin(nin: string) {
  return /^\d{11}$/.test(nin.trim());
}

export default function VerifyIdentityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { identity, submitNin, refreshIdentity, accountLoaded } = useApp();
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  const [nin, setNin] = useState(identity.nin);
  const [fullName, setFullName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const prevStatus = useRef(identity.status);
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (prevStatus.current === 'pending' && identity.status === 'verified') {
      Animated.spring(pop, {
        toValue: 1,
        useNativeDriver: true,
        tension: 58,
        friction: 7,
      }).start();
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
    prevStatus.current = identity.status;
  }, [identity.status, pop]);

  /**
   * A reviewer decides this, so the wait is real and open-ended. Polling while
   * the screen is open means the outcome appears without a manual refresh.
   */
  useEffect(() => {
    void refreshIdentity();
    if (identity.status !== 'pending') return;
    const timer = setInterval(() => void refreshIdentity(), 15_000);
    return () => clearInterval(timer);
  }, [identity.status, refreshIdentity]);

  async function handleSubmit() {
    if (!valid || submitting) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitError(null);
    setSubmitting(true);
    const result = await submitNin(nin.trim(), fullName.trim());
    setSubmitting(false);
    if (!result.ok) setSubmitError(result.detail ?? 'Could not send it. Try again.');
  }

  const valid = isValidNin(nin) && fullName.trim().length >= 3;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingTop: topPad }]}
      >
        <Pressable
          onPress={() => router.back()}
          style={[styles.backBtn, { borderColor: colors.border }]}
        >
          <Ionicons name="arrow-back" size={18} color={colors.foreground} />
        </Pressable>

        {/* The form is the default branch, so showing it before the status is
            known offers a submit button to people who are already pending or
            already verified — and a duplicate submission the server rejects. */}
        {!accountLoaded ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={colors.mutedForeground} />
            <Text style={[text.bodySmall, { color: colors.mutedForeground }]}>
              Checking where your verification got to…
            </Text>
          </View>
        ) : identity.status === 'verified' ? (
          <Animated.View
            style={{
              transform: [
                { scale: pop.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.04, 1] }) },
              ],
            }}
          >
            <View style={[styles.seal, { backgroundColor: colors.primary }]}>
              <Ionicons name="shield-checkmark" size={30} color={colors.primaryForeground} />
            </View>
            <Text style={[text.display, { color: colors.foreground, marginTop: 22 }]}>
              You are verified.
            </Text>
            <Text style={[text.body, { color: colors.mutedForeground, marginTop: 10 }]}>
              Higher-paying and restricted jobs are now open to you, and your answers
              carry a verified badge.
            </Text>

            <View style={[styles.ninChip, { borderColor: colors.border }]}>
              <Text style={[text.data, { color: colors.faintForeground }]}>NIN</Text>
              <Text style={[styles.ninMasked, { color: colors.foreground }]}>
                ••• ••• {identity.nin.slice(-5)}
              </Text>
            </View>

            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.wideBtn,
                { backgroundColor: colors.foreground, opacity: pressed ? 0.88 : 1 },
              ]}
            >
              <Text style={[text.action, { color: colors.background }]}>Done</Text>
            </Pressable>
          </Animated.View>
        ) : identity.status === 'pending' ? (
          <>
            <Text style={[text.label, { color: colors.pending, marginTop: 24 }]}>Checking</Text>
            <Text style={[text.display, { color: colors.foreground, marginTop: 6 }]}>
              We are confirming{'\n'}your NIN.
            </Text>
            <Text style={[text.body, { color: colors.mutedForeground, marginTop: 10 }]}>
              Someone on our side checks this by hand, so it can take a little while. You can leave
              this screen — the badge appears on your profile once it is approved.
            </Text>

            <View style={[styles.ninChip, { borderColor: colors.border }]}>
              <Text style={[text.data, { color: colors.faintForeground }]}>Submitted</Text>
              <Text style={[styles.ninMasked, { color: colors.foreground }]}>
                ••• ••• {nin.slice(-5)}
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text style={[text.label, { color: colors.faintForeground, marginTop: 24 }]}>
              Identity
            </Text>
            <Text style={[text.display, { color: colors.foreground, marginTop: 6 }]}>
              Prove it is you.
            </Text>
            <Text style={[text.body, { color: colors.mutedForeground, marginTop: 10 }]}>
              Askers are paying strangers to go somewhere on their behalf. Verifying once keeps that
              honest for everybody.
            </Text>

            <View style={[styles.reasons, { borderColor: colors.border }]}>
              {[
                { k: 'Unlocks', v: `Jobs paying ₦${formatNaira(VERIFIED_ONLY_ABOVE)} and above` },
                { k: 'Also', v: 'Any job an asker restricted to verified people' },
                { k: 'Standing', v: 'A verified badge on every answer you send' },
                { k: 'Seen by', v: 'Our review team only, never other users' },
              ].map((r, i) => (
                <View
                  key={r.k}
                  style={[
                    styles.reasonRow,
                    i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                  ]}
                >
                  <Text style={[text.data, { color: colors.faintForeground, width: 74 }]}>
                    {r.k}
                  </Text>
                  <Text style={[text.bodySmall, { color: colors.foreground, flex: 1 }]}>{r.v}</Text>
                </View>
              ))}
            </View>

            {/* Benefit, then reassurance, then the ask. Handing over a
                national ID number is the most exposing thing the app asks
                for, so what does not travel is said before the field. */}
            <View style={[styles.sealed, { borderColor: colors.primary }]}>
              <View style={styles.sealedHead}>
                <Ionicons name="lock-closed" size={15} color={colors.primary} />
                <Text style={[text.subheading, { color: colors.primary, flex: 1 }]}>
                  Nobody on the app ever sees this
                </Text>
              </View>
              <Text style={[text.bodySmall, { color: colors.mutedForeground }]}>
                Verifying does not expose you. Askers never learn who you are, and you never learn
                who they are. Both sides only ever see a first name and whether the badge is
                there.
              </Text>
              <Text style={[text.bodySmall, { color: colors.mutedForeground }]}>
                No NIN, no surname, no email, no phone number crosses between you — in either
                direction, ever.
              </Text>
            </View>

            <Text style={[text.label, { color: colors.faintForeground, marginTop: 28 }]}>
              Your name, as it appears on the NIN
            </Text>
            <TextInput
              style={[
                styles.nameField,
                {
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  borderColor: colors.borderStrong,
                },
              ]}
              placeholder="Chidi Okafor"
              placeholderTextColor={colors.faintForeground}
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
              autoCorrect={false}
            />

            <Text style={[text.label, { color: colors.faintForeground, marginTop: 18 }]}>
              Your 11-digit NIN
            </Text>
            <View
              style={[
                styles.ninField,
                {
                  backgroundColor: colors.surface,
                  borderColor: valid ? colors.primary : colors.borderStrong,
                },
              ]}
            >
              <TextInput
                style={[styles.ninInput, { color: colors.foreground }]}
                placeholder="00000000000"
                placeholderTextColor={colors.faintForeground}
                value={nin}
                onChangeText={(t) => setNin(t.replace(/\D/g, '').slice(0, 11))}
                keyboardType="numeric"
                maxLength={11}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
              <Text
                style={[text.data, { color: valid ? colors.primary : colors.faintForeground }]}
              >
                {nin.length}/11
              </Text>
            </View>
            <Text style={[text.bodySmall, { color: colors.faintForeground, marginTop: 8 }]}>
              From your NIMC slip or National ID card.
            </Text>

            {identity.status === 'rejected' && identity.reason && (
              <View style={[styles.rejected, { borderColor: colors.danger }]}>
                <Ionicons name="close-circle-outline" size={15} color={colors.danger} />
                <View style={{ flex: 1 }}>
                  <Text style={[text.data, { color: colors.danger }]}>Not approved</Text>
                  <Text style={[text.bodySmall, { color: colors.foreground, marginTop: 2 }]}>
                    {identity.reason}
                  </Text>
                </View>
              </View>
            )}

            {submitError && (
              <Text style={[text.bodySmall, { color: colors.danger, marginTop: 10 }]}>
                {submitError}
              </Text>
            )}

            <Pressable
              onPress={handleSubmit}
              disabled={!valid || submitting}
              style={({ pressed }) => [
                styles.wideBtn,
                {
                  backgroundColor: valid ? colors.foreground : colors.sunken,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}
            >
              <Text
                style={[
                  text.action,
                  { color: valid ? colors.background : colors.faintForeground },
                ]}
              >
                Verify me
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingHorizontal: 22, paddingBottom: 44 },
  loadingState: { alignItems: 'center', gap: 12, paddingVertical: 80 },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  seal: {
    width: 74,
    height: 74,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 26,
  },

  reasons: { borderWidth: 2, borderRadius: 2, marginTop: 24 },
  sealed: { borderWidth: 2, borderRadius: 2, padding: 14, gap: 8, marginTop: 20 },
  sealedHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },

  ninChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    alignSelf: 'flex-start',
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 22,
  },
  ninMasked: { fontFamily: font.monoMedium, fontSize: 15, letterSpacing: 1 },

  nameField: {
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 8,
    fontFamily: font.sans,
    fontSize: 16,
  },
  rejected: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'flex-start',
    borderWidth: 2,
    borderRadius: 2,
    padding: 12,
    marginTop: 14,
  },
  ninField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 18,
    paddingVertical: 15,
    marginTop: 10,
  },
  ninInput: { flex: 1, fontFamily: font.monoMedium, fontSize: 20, letterSpacing: 2 },

  wideBtn: {
    borderRadius: 2,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
});
