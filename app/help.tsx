import React, { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';
import { formatNaira } from '@/constants/money';
import { VERIFIED_ONLY_ABOVE } from '@/constants/money';

const SUPPORT_EMAIL = 'help@confam.xyz';

/** The questions the flow actually raises, answered where they are asked. */
const FAQ: { q: string; a: string }[] = [
  {
    q: 'Nobody has taken my question. What now?',
    a: 'Once the window you set runs out, open the question and you can close it and take the whole amount back, or leave it up and keep waiting. Raising the amount also gets it picked up faster.',
  },
  {
    q: 'The evidence looks wrong. Do I have to pay?',
    a: 'No. Press Query instead of confirming. Support reviews both sides before any money moves, and the money stays held until that is settled.',
  },
  {
    q: 'When exactly does the verifier get paid?',
    a: 'The moment you confirm the evidence. Until then the amount sits held against your question — it has left your balance but has not reached them.',
  },
  {
    q: 'Why can I not take some jobs?',
    a: `Askers can restrict a job to people who have confirmed their identity, and anything paying ₦${formatNaira(VERIFIED_ONLY_ABOVE)} or more is restricted automatically. Confirm your identity and they open up.`,
  },
  {
    q: 'Why must evidence be taken with the camera?',
    a: 'Because a picture from your gallery could have been taken anywhere, at any time. Capturing it there and then is what makes the answer worth paying for.',
  },
  {
    q: 'My question was answered but the place has changed since.',
    a: 'Answers age. Check the timestamp on the answer — anything over a few hours old is worth paying to recheck, and the app will tell you when it thinks so.',
  },
];

export default function HelpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  const [open, setOpen] = useState<string | null>(null);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: topPad }]}
      >
        <Pressable
          onPress={() => router.back()}
          style={[styles.backBtn, { borderColor: colors.border }]}
        >
          <Ionicons name="arrow-back" size={18} color={colors.foreground} />
        </Pressable>

        <Text style={[text.display, { color: colors.foreground, marginTop: 22 }]}>Get help</Text>

        <Text style={[text.label, styles.groupLabel, { color: colors.faintForeground }]}>
          Common questions
        </Text>

        {FAQ.map((item) => {
          const expanded = open === item.q;
          return (
            <Pressable
              key={item.q}
              onPress={() => setOpen(expanded ? null : item.q)}
              style={[styles.faq, { borderBottomColor: colors.border }]}
            >
              <View style={styles.faqHead}>
                <Text style={[text.subheading, { color: colors.foreground, flex: 1 }]}>
                  {item.q}
                </Text>
                <Ionicons
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={15}
                  color={colors.mutedForeground}
                />
              </View>
              {expanded && (
                <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 8 }]}>
                  {item.a}
                </Text>
              )}
            </Pressable>
          );
        })}

        <Text style={[text.label, styles.groupLabel, { color: colors.faintForeground }]}>
          Still stuck
        </Text>

        <Pressable
          onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          style={({ pressed }) => [
            styles.contact,
            { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="mail-outline" size={17} color={colors.foreground} />
          <View style={{ flex: 1 }}>
            <Text style={[text.heading, { color: colors.foreground }]}>Email us</Text>
            <Text style={[text.data, { color: colors.faintForeground }]}>{SUPPORT_EMAIL}</Text>
          </View>
          <Ionicons name="open-outline" size={15} color={colors.mutedForeground} />
        </Pressable>

        <Text style={[text.bodySmall, { color: colors.faintForeground, marginTop: 12 }]}>
          If it is about a specific question or job, include the place and roughly when it
          happened. That is enough for us to find it.
        </Text>
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
  groupLabel: { marginTop: 30, marginBottom: 4 },
  faq: { paddingVertical: 15, borderBottomWidth: 1 },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
});
