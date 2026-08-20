import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import { formatNaira, verifierCut } from '@/constants/money';
import { useApp, type Dispute } from '@/contexts/AppContext';

/**
 * The verifier's side of a contested job. They answer the objection here;
 * they never decide it. Only an admin can move the money.
 */
export default function DisputesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { disputes, replyToDispute } = useApp();
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const toAnswer = disputes.filter((d) => d.status === 'awaiting_verifier');
  const settledOrWaiting = disputes.filter((d) => d.status !== 'awaiting_verifier');

  function statusLabel(dispute: Dispute) {
    switch (dispute.status) {
      case 'awaiting_admin':
        return { label: 'With a reviewer', tone: colors.pending };
      case 'resolved_verifier':
        return { label: 'You were paid', tone: colors.primary };
      case 'resolved_asker':
        return { label: 'Refunded to the asker', tone: colors.danger };
      default:
        return { label: 'Needs your answer', tone: colors.pending };
    }
  }

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

        <Text style={[text.display, { color: colors.foreground, marginTop: 22 }]}>Queries</Text>
        <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 6 }]}>
          {toAnswer.length > 0
            ? `${toAnswer.length} waiting on you. Answer and a reviewer decides.`
            : 'Nothing waiting on you.'}
        </Text>

        {toAnswer.map((dispute) => {
          const draft = drafts[dispute.id] ?? '';
          const valid = draft.trim().length >= 10;

          return (
            <View key={dispute.id} style={[styles.card, { borderColor: colors.pending }]}>
              <Text style={[text.label, { color: colors.pending }]}>Needs your answer</Text>
              <Text style={[text.heading, { color: colors.foreground, marginTop: 4 }]}>
                {dispute.question}
              </Text>
              <Text style={[text.data, { color: colors.faintForeground }]}>
                {dispute.placeName} · your cut ₦{formatNaira(verifierCut(dispute.bounty))}
              </Text>

              <View style={[styles.side, { borderColor: colors.border }]}>
                <Text style={[text.data, { color: colors.faintForeground }]}>
                  {dispute.askerName} said
                </Text>
                <Text style={[text.bodySmall, { color: colors.foreground, marginTop: 3 }]}>
                  {dispute.askerReason}
                </Text>
              </View>

              <TextInput
                style={[
                  styles.replyField,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.surface,
                    borderColor: colors.borderStrong,
                  },
                ]}
                value={draft}
                onChangeText={(v) => setDrafts((prev) => ({ ...prev, [dispute.id]: v }))}
                placeholder="Explain what you saw and where you were standing…"
                placeholderTextColor={colors.faintForeground}
                multiline
              />

              <Text
                style={[text.data, { color: valid ? colors.faintForeground : colors.pending }]}
              >
                {valid
                  ? 'A reviewer reads this next to your evidence.'
                  : 'Say a little more — at least a sentence.'}
              </Text>

              <Pressable
                onPress={() => {
                  if (!valid) return;
                  replyToDispute(dispute.id, draft.trim());
                  setDrafts((prev) => ({ ...prev, [dispute.id]: '' }));
                }}
                disabled={!valid}
                style={({ pressed }) => [
                  styles.send,
                  {
                    backgroundColor: valid ? colors.primary : colors.sunken,
                    opacity: pressed ? 0.88 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    text.action,
                    { color: valid ? colors.primaryForeground : colors.faintForeground },
                  ]}
                >
                  Send my answer
                </Text>
              </Pressable>
            </View>
          );
        })}

        {settledOrWaiting.length > 0 && (
          <>
            <Text style={[text.label, styles.groupLabel, { color: colors.faintForeground }]}>
              Everything else
            </Text>
            {settledOrWaiting.map((dispute) => {
              const status = statusLabel(dispute);
              return (
                <View key={dispute.id} style={[styles.card, { borderColor: colors.border }]}>
                  <Text style={[text.label, { color: status.tone }]}>{status.label}</Text>
                  <Text style={[text.subheading, { color: colors.foreground, marginTop: 4 }]}>
                    {dispute.question}
                  </Text>
                  {dispute.adminNote && (
                    <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 6 }]}>
                      Reviewer: {dispute.adminNote}
                    </Text>
                  )}
                </View>
              );
            })}
          </>
        )}

        {disputes.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="shield-outline" size={26} color={colors.faintForeground} />
            <Text
              style={[
                text.body,
                { color: colors.mutedForeground, textAlign: 'center', maxWidth: 270 },
              ]}
            >
              If an asker queries your evidence it appears here, and you get to answer before
              anyone decides.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 44 },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupLabel: { marginTop: 30, marginBottom: 10 },
  card: { borderWidth: 2, borderRadius: 2, padding: 15, gap: 8, marginTop: 16 },
  side: { borderWidth: 2, borderRadius: 2, padding: 11 },
  replyField: {
    borderWidth: 2,
    borderRadius: 2,
    padding: 12,
    minHeight: 88,
    textAlignVertical: 'top',
    fontFamily: font.sans,
    fontSize: 15,
  },
  send: { borderRadius: 2, paddingVertical: 14, alignItems: 'center', marginTop: 2 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 70 },
});
