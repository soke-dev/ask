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

      'YOUR WALLET IS YOURS ALONE. It is non-custodial: the keys are held on your device and by your wallet provider, never by us. We cannot move your funds, freeze them, reverse a payment, or recover them if you lose access. A transaction confirmed on the Base network is final and cannot be undone by anyone, including us.',

      'WE DO NOT HOLD YOUR MONEY. A bounty is locked by a smart contract on Base. We are not a bank, a custodian, a payment processor or a money transmitter, and we take no deposits. The contract pays out according to its own rules and a decision you or a reviewer make.',

      'THE SERVICE IS PROVIDED AS IS. We make no warranty, express or implied, that an answer is accurate, complete, current, or fit for any purpose. An answer describes one moment at one place as one person found it. Do not rely on one for a decision involving safety, money, health, property or legal rights without checking it yourself.',

      'VERIFIERS ARE INDEPENDENT. They are not our employees, agents, partners or representatives. We do not direct, supervise or control what they do, and we are not responsible for their conduct, their accuracy, their honesty, or anything that happens to them or to anyone else while they are doing a job.',

      'WE ARE NOT LIABLE FOR LOSS. To the fullest extent the law allows, we are not liable for any indirect, incidental, special, consequential, punitive or exemplary loss, nor for lost profit, lost data, lost opportunity, or business interruption, however caused, even if we were told such loss was possible.',

      `WHERE LIABILITY CANNOT BE EXCLUDED, IT IS CAPPED. Our total liability to you for any claim is limited to the greater of the amount you paid us in fees on the specific question the claim concerns, or ₦${formatNaira(10000)}. This cap applies however the claim is framed, in contract, in negligence or otherwise.`,

      'WE ARE NOT LIABLE FOR THINGS OUTSIDE OUR CONTROL. That includes the Base network, its congestion, forks, reorganisations or downtime; a fault in a smart contract; the exchange rate; your wallet provider; a geocoding provider; a model provider; your device; your network; or any act of a third party.',

      'YOU INDEMNIFY US. If a claim is brought against us because of how you used the app, what you asked for, what you did on a job, or because you broke these terms or the law, you will cover our losses and our reasonable legal costs.',

      'You must be 18 or older and legally able to enter a contract. You are responsible for the tax on anything you earn here.',

      'These terms are governed by the laws of the Federal Republic of Nigeria. Nothing here removes a right you have under consumer law that cannot be excluded by agreement.',
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
          Confam AI
        </Text>

        <Text style={[text.body, { color: colors.mutedForeground }]}>
          Every question goes to the agent first. It reads what somebody already verified about
          that place and how long ago, weighs it against what you are asking, and decides one
          thing: does anybody have to go.
        </Text>
        <Text style={[text.body, { color: colors.mutedForeground, marginTop: 10 }]}>
          It never answers from its own knowledge. Everything it gives you came from a person who
          stood there and photographed it, so a wrong answer is a wrong photograph rather than a
          confident guess. When it decides the evidence has aged past being true, it sends
          somebody instead, and tells you why in plain words before you spend anything.
        </Text>
        <Text style={[text.body, { color: colors.mutedForeground, marginTop: 10 }]}>
          It also reads evidence as it arrives, checking it is clear enough and shows what was
          asked. It can flag work but never rejects it: the person who walked there can send it
          anyway, and you decide.
        </Text>
        <Text style={[text.body, { color: colors.mutedForeground, marginTop: 10 }]}>
          Programs can use it too. You → Confam AI issues a key, and an agent can ask questions
          and pay verifiers exactly as the app does.
        </Text>

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

        {/*
          * Said before the documents rather than buried after them.
          *
          * These describe what the app actually does and are written to be
          * read, which is not the same as having been settled by a lawyer for
          * the country they operate in. A limitation of liability that has
          * never been reviewed is the clause most likely not to hold when it
          * is finally needed.
          */}
        <Text style={[text.bodySmall, { color: colors.faintForeground, marginBottom: 6 }]}>
          Written in plain language so they can be read. They have not yet been reviewed by a
          lawyer, and some limits below may be narrower in practice than they are written,
          because consumer law overrides an agreement in places.
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
