import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';
import { useApp } from '@/contexts/AppContext';
import { SettingToggle } from '@/components/SettingToggle';

/** What the app holds and what it never holds. Stated, not buried. */
const FACTS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: 'person-outline',
    title: 'Others see your first name only',
    body: 'Never your surname, your email, or your phone number — in either direction. Nobody meets anybody on a job, so there is nothing to coordinate.',
  },
  {
    icon: 'location-outline',
    title: 'Location is read when you take a job',
    body: 'Not in the background, and not while you are only browsing. It is used to show the asker that someone genuinely reached the place.',
  },
  {
    icon: 'card-outline',
    title: 'Your NIN is never stored',
    body: 'It is checked once and only the result is kept. The number itself is not saved, so it cannot leak from here.',
  },
  {
    icon: 'camera-outline',
    title: 'Your photo library is never read for evidence',
    body: 'Job evidence is always captured with the camera. The library is only opened if you choose a profile picture.',
  },
];

/**
 * The app sends a real person to a real address. That makes a few uses
 * genuinely dangerous rather than merely against the rules, so they are
 * spelled out rather than buried in a document nobody opens.
 */
const FORBIDDEN: string[] = [
  'Watching, following or gathering information about a specific person',
  'Scouting a home, shop or vehicle for theft, or checking whether someone is out',
  'Asking anyone to enter private property, trespass, or break any law',
  'Sending someone into a protest, a fire, a crash, or anywhere unsafe',
  'Harassing, intimidating or targeting anyone through a question',
  'Photographing children, hospital patients, or anyone who has refused',
];

export default function PrivacyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { answersPublicByDefault, setAnswersPublicByDefault } = useApp();
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

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

        <Text style={[text.display, { color: colors.foreground, marginTop: 22 }]}>
          Privacy & security
        </Text>

        <Text style={[text.label, styles.groupLabel, { color: colors.faintForeground }]}>
          Your choices
        </Text>

        <SettingToggle
          label="Share answers by default"
          detail="Pre-selects sharing when you pay for a question. You can still change it each time."
          value={answersPublicByDefault}
          onChange={setAnswersPublicByDefault}
        />

        <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 12 }]}>
          A shared answer is what lets the next person asking about the same place get it instantly
          and free. A private one is only ever shown to you.
        </Text>

        <Text style={[text.label, styles.groupLabel, { color: colors.faintForeground }]}>
          What we hold
        </Text>

        {FACTS.map((fact) => (
          <View key={fact.title} style={[styles.fact, { borderBottomColor: colors.border }]}>
            <View style={[styles.factIcon, { borderColor: colors.border }]}>
              <Ionicons name={fact.icon} size={15} color={colors.mutedForeground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[text.subheading, { color: colors.foreground }]}>{fact.title}</Text>
              <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 3 }]}>
                {fact.body}
              </Text>
            </View>
          </View>
        ))}

        {/* ── Rules ─────────────────────────────────────────────── */}
        <Text style={[text.label, styles.groupLabel, { color: colors.danger }]}>
          What you must never do
        </Text>

        <View style={[styles.rules, { borderColor: colors.danger }]}>
          <Text style={[text.bodySmall, { color: colors.mutedForeground }]}>
            A question sends a real person to a real address. Do not use it for:
          </Text>

          {FORBIDDEN.map((rule) => (
            <View key={rule} style={styles.ruleRow}>
              <Ionicons name="close" size={14} color={colors.danger} />
              <Text style={[text.bodySmall, { color: colors.foreground, flex: 1 }]}>{rule}</Text>
            </View>
          ))}

          <Text style={[text.data, { color: colors.faintForeground, marginTop: 2 }]}>
            Break these and the account goes, any money held is returned to nobody's benefit, and
            anything criminal is handed to the police.
          </Text>
        </View>

        <View style={[styles.refuse, { borderColor: colors.primary }]}>
          <Ionicons name="hand-left-outline" size={16} color={colors.primary} />
          <Text style={[text.bodySmall, { color: colors.mutedForeground, flex: 1 }]}>
            <Text style={{ color: colors.primary }}>If you are the one going: </Text>
            you can refuse or abandon any job that feels unsafe or wrong, at any point, and it
            will not count against you. Report it and we take the asker off.
          </Text>
        </View>

        <Text style={[text.label, styles.groupLabel, { color: colors.faintForeground }]}>
          Your account
        </Text>

        {[
          { label: 'Download my data', detail: 'Everything held about you, as a file' },
          { label: 'Delete my account', detail: 'Removes your profile and history for good' },
        ].map((row) => (
          <View key={row.label} style={[styles.lockedRow, { borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[text.subheading, { color: colors.faintForeground }]}>{row.label}</Text>
              <Text style={[text.data, { color: colors.faintForeground, marginTop: 2 }]}>
                {row.detail}
              </Text>
            </View>
            <View style={[styles.soon, { borderColor: colors.pending }]}>
              <Text style={[text.data, { color: colors.pending }]}>Coming soon</Text>
            </View>
          </View>
        ))}
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
  groupLabel: { marginTop: 30, marginBottom: 6 },
  fact: { flexDirection: 'row', gap: 12, paddingVertical: 15, borderBottomWidth: 1 },
  factIcon: {
    width: 30,
    height: 30,
    borderWidth: 2,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    borderBottomWidth: 1,
  },
  soon: { borderWidth: 2, borderRadius: 2, paddingHorizontal: 8, paddingVertical: 4 },
  rules: { borderWidth: 2, borderRadius: 2, padding: 14, gap: 10 },
  ruleRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  refuse: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: 2,
    borderRadius: 2,
    padding: 13,
    marginTop: 10,
  },
});
