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
    a: 'No. Press Query instead of confirming. A reviewer reads both sides before any money moves, and until they rule nobody can touch it, including us: the amount is frozen in a contract that only accepts the ruling itself.',
  },
  {
    q: 'When exactly does the verifier get paid?',
    a: 'The moment you confirm the evidence. Until then the amount sits locked against your question. It has left your balance but has not reached them.',
  },
  {
    q: 'Why can I not take some jobs?',
    a: `Askers can restrict a job to people who have confirmed their identity, and anything paying ₦${formatNaira(VERIFIED_ONLY_ABOVE)} or more is restricted automatically. Confirm your identity and they open up.`,
  },
  {
    q: 'What is Confam AI?',
    a: 'The part that decides whether anybody has to go. Ask about a place and it reads what somebody already verified there, weighs how old that is against what you are asking, and either answers you from it or sends a person. It is not answering from its own knowledge; every answer it gives came from somebody who stood there.',
  },
  {
    q: 'Why did I get an answer without paying the full amount?',
    a: 'Because somebody had already checked that place recently and shared their answer, so nobody needed to go again. You pay a fraction of a full job, and you can tip the person whose photograph answered you.',
  },
  {
    q: 'Why did it send somebody when there was already an answer?',
    a: 'Because the answer did not cover your question, or it had aged past the point of being true. A photograph of a flooded road does not tell you whether the market is open, and a fuel queue from this morning tells you nothing about now. It says which of those it decided, in plain words, before you spend anything.',
  },
  {
    q: 'Does Confam AI look at my photos?',
    a: 'Yes. Evidence is read, with the question, to check it is clear enough and shows what was asked. That sends it to a model provider, so it leaves our servers. It is not used to train anything, and a model never rejects your work on its own: if it flags something you can still send it, and a reviewer decides.',
  },
  {
    q: 'Can my own program use this?',
    a: 'Yes. You → Confam AI creates an API key, and a program can ask questions, get answers and pay verifiers the same way the app does. Jobs it posts reach the same board and the same people.',
  },
  {
    q: 'Why must evidence be taken with the camera?',
    a: 'Because a picture from your gallery could have been taken anywhere, at any time. Capturing it there and then is what makes the answer worth paying for.',
  },
  {
    q: 'My question was answered but the place has changed since.',
    a: 'Answers age, and Confam AI judges that for you. A power cut checked twenty minutes ago still stands; a queue from four hours ago does not. When it decides an answer has gone stale it sends somebody rather than handing it to you.',
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
