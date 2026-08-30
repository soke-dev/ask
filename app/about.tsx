import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import { FEE_PERCENT, VERIFIED_ONLY_ABOVE, formatNaira } from '@/constants/money';
import { Wordmark } from '@/components/Wordmark';

const STEPS = [
  {
    n: '01',
    title: 'You ask about a place',
    body: 'A question and the spot it is about. Asking costs nothing.',
  },
  {
    n: '02',
    title: 'Confam AI checks what is known',
    body: 'It reads what somebody already verified about that place and how old it is, and decides whether that still answers you. If it does, you get it straight away with the photograph, and you can tip whoever took it.',
  },
  {
    n: '03',
    title: 'Otherwise someone goes',
    body: 'You set what you will pay and how long they have. Whoever takes it first goes there in person.',
  },
  {
    n: '04',
    title: 'You decide',
    body: 'Photo or video comes back with the time and how far from the place it was taken. Confirm it and they are paid. Query it and a reviewer rules before any money moves.',
  },
];

/**
 * Plain-language versions of the three documents, written out here rather
 * than linked to a page that does not exist. Paragraphs are separate strings
 * so they can be spaced properly rather than run together by newlines.
 *
 * They describe what the app actually does — but a shipped product still
 * needs these reviewed by a lawyer, and the page says so.
 */
const LEGAL: { title: string; body: string[] }[] = [
  {
    title: 'Terms of service',
    body: [
      'Confam connects people who want something checked with people already nearby who will go and check it.',
      'We are not the one going. Verifiers are independent. They choose which jobs to take, and they are responsible for how they behave while doing them.',
      `When you pay for a question the amount is held, not sent. It is locked in a contract on the Base network in USDC, and it reaches the verifier only when you confirm their evidence, less our ${FEE_PERCENT}. If nobody delivers inside the window you set, you take the whole amount back.`,
      'A queried answer freezes the money until a reviewer rules. Neither side can move it in the meantime, including us: the contract only accepts a ruling from one account, and that ruling is what pays out or refunds.',
      'Programs can ask questions too, with a key. A job an agent posted reaches the same board and pays the same person; if the agent never comes back to accept an answer, it is accepted for them after fifteen minutes so nobody who walked somewhere is left waiting.',
      'Answers describe one moment at one place. Things change. We do not promise an answer is still true later, and you should not lean on one for a decision that matters without checking it again.',
      'Using the app for surveillance, for scouting a target, for harassment, or to ask anyone to break the law ends the account immediately.',
    ],
  },
  {
    title: 'Privacy policy',
    body: [
      'We hold your email, the name and username you choose, a profile picture if you add one, the area you set, and the questions and jobs you take part in.',
      'Your location is read when you accept a job and when you capture evidence. Not in the background, and not while you are only browsing.',
      'Your ID number is retained after submission and used solely for identity verification: confirming you are a real person, preventing duplicate and fraudulent accounts, and enabling access to jobs that require a verified identity. Access is restricted to the review team, and it is never disclosed to other users.',
      'Other people see your username, whether your identity is confirmed, and how many jobs you have finished. Never your email, your real name or your phone number.',
      'Answers you mark as shared are shown to other people asking about the same place. Answers you keep private are not, ever.',
      'Place searches are sent to whichever geocoding provider the app is configured with, so they can be resolved.',
      'Evidence you submit is read by Confam AI, with the question, to judge whether it shows what was asked. Doing that sends it to a third-party model provider, so it leaves our servers. It is not used to train anything, and a model never rejects your work on its own.',
      'When a job is claimed, a keccak256 hash of your evidence file is written to the Base network and signed by your wallet, so anybody can check the evidence was not swapped afterwards. The file itself is never put on chain. The hash, your wallet address and the amounts are public and permanent, and cannot be deleted by us or by you.',
      'Your wallet address is on a public blockchain by its nature. Anything paid to it can be seen by anyone who knows it.',
      'If you allow notifications we keep a device token so we can reach you. Turning them off in your phone retires it.',
    ],
  },
  {
    title: 'Open source licences',
    body: [
      'This app is built on work other people gave away.',
      'React and React Native · MIT',
      'Expo and its modules, including Expo Router · MIT',
      'React Navigation · MIT',
      'react-native-svg and react-native-qrcode-svg · MIT',
      'Ionicons · MIT',
      'viem, for talking to Base · MIT',
      'Barlow, by Jeremy Tribby · SIL Open Font Licence 1.1',
      'IBM Plex Mono, by IBM · SIL Open Font Licence 1.1',
      'Place data comes from OpenStreetMap contributors under the ODbL, unless a commercial provider is configured.',
    ],
  },
];

export default function AboutScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;
  const [openDoc, setOpenDoc] = useState<string | null>(null);

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

        <View style={{ marginTop: 24 }}>
          <Wordmark size={22} />
        </View>

        <Text style={[text.titleSoft, { color: colors.foreground, marginTop: 14 }]}>
          Real answers from people who are actually there.
        </Text>

        <Text style={[text.body, { color: colors.mutedForeground, marginTop: 10 }]}>
          Some things cannot be looked up. Whether a street floods, whether the queue is worth it,
          whether the shop is really open. Confam pays somebody already standing there to look
          and show you.
        </Text>

        <Text style={[text.label, styles.groupLabel, { color: colors.faintForeground }]}>
          How it works
        </Text>

        {STEPS.map((step) => (
          <View key={step.n} style={styles.step}>
            <Text style={[text.dataMedium, styles.stepNum, { color: colors.accent }]}>
              {step.n}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={[text.subheading, { color: colors.foreground }]}>{step.title}</Text>
              <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 2 }]}>
                {step.body}
              </Text>
            </View>
          </View>
        ))}

        <Text style={[text.label, styles.groupLabel, { color: colors.faintForeground }]}>
          The rules
        </Text>

        <View style={[styles.table, { borderColor: colors.border }]}>
          {[
            { k: 'Platform fee', v: `${FEE_PERCENT} of what the asker pays` },
            { k: 'Verified only', v: `Automatic above ₦${formatNaira(VERIFIED_ONLY_ABOVE)}` },
            { k: 'One job', v: 'One verifier, locked until it expires' },
            { k: 'Refunds', v: 'Full, if nobody delivers in your window' },
            { k: 'Settlement', v: 'USDC on Base, when you confirm' },
          ].map((row, i) => (
            <View
              key={row.k}
              style={[
                styles.tableRow,
                i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
              ]}
            >
              <Text style={[text.bodySmall, { color: colors.mutedForeground, flex: 1 }]}>
                {row.k}
              </Text>
              <Text
                style={[text.data, { color: colors.foreground, flex: 1.3, textAlign: 'right' }]}
              >
                {row.v}
              </Text>
            </View>
          ))}
        </View>

        <Text style={[text.label, styles.groupLabel, { color: colors.faintForeground }]}>
          Legal
        </Text>

        {LEGAL.map((doc) => {
          const expanded = openDoc === doc.title;
          return (
            <Pressable
              key={doc.title}
              onPress={() => setOpenDoc(expanded ? null : doc.title)}
              style={[styles.legalRow, { borderBottomColor: colors.border }]}
            >
              <View style={styles.legalHead}>
                <Text style={[text.subheading, { color: colors.foreground, flex: 1 }]}>
                  {doc.title}
                </Text>
                <Ionicons
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={15}
                  color={colors.mutedForeground}
                />
              </View>
              {expanded &&
                doc.body.map((para) => (
                  <Text
                    key={para}
                    style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 10 }]}
                  >
                    {para}
                  </Text>
                ))}
            </Pressable>
          );
        })}


        <Text style={[text.data, styles.version, { color: colors.faintForeground }]}>
          Version 1.0.0
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
  groupLabel: { marginTop: 30, marginBottom: 12 },
  step: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  stepNum: { paddingTop: 2 },
  table: { borderWidth: 2, borderRadius: 2 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  legalRow: { paddingVertical: 15, borderBottomWidth: 1 },
  legalHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  version: { marginTop: 28 },
});
