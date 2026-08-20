import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';
import { useApp, type AlertPrefs } from '@/contexts/AppContext';
import { SettingToggle } from '@/components/SettingToggle';

const GROUPS: {
  heading: string;
  items: { key: keyof AlertPrefs; label: string; detail: string }[];
}[] = [
  {
    heading: 'When you are earning',
    items: [
      {
        key: 'jobsNearby',
        label: 'New jobs near you',
        detail: 'A question was paid for in your area',
      },
      {
        key: 'payments',
        label: 'You were paid',
        detail: 'An asker confirmed your evidence and the money settled',
      },
    ],
  },
  {
    heading: 'When you are asking',
    items: [
      {
        key: 'questionTaken',
        label: 'Someone took your question',
        detail: 'A verifier accepted it and is heading there',
      },
      {
        key: 'evidenceBack',
        label: 'Evidence came back',
        detail: 'There is something waiting for you to confirm or query',
      },
      {
        key: 'reviews',
        label: 'Queries and reviews',
        detail: 'Progress on anything you or a verifier disputed',
      },
    ],
  },
  {
    heading: 'From us',
    items: [
      {
        key: 'productNews',
        label: 'Product news',
        detail: 'New features and changes. Off unless you want it',
      },
    ],
  },
];

export default function AlertsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { alertPrefs, setAlertPref } = useApp();
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

        <Text style={[text.display, { color: colors.foreground, marginTop: 22 }]}>Alerts</Text>
        <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 6 }]}>
          Money and deadlines move without you watching, so these are the things worth an
          interruption.
        </Text>

        {GROUPS.map((group) => (
          <View key={group.heading}>
            <Text style={[text.label, styles.groupLabel, { color: colors.faintForeground }]}>
              {group.heading}
            </Text>
            {group.items.map((item) => (
              <SettingToggle
                key={item.key}
                label={item.label}
                detail={item.detail}
                value={alertPrefs[item.key]}
                onChange={(next) => setAlertPref(item.key, next)}
              />
            ))}
          </View>
        ))}

        {/* Turning everything off has a real cost here, so say it plainly. */}
        <View style={[styles.note, { borderColor: colors.border }]}>
          <Ionicons name="information-circle-outline" size={15} color={colors.pending} />
          <Text style={[text.bodySmall, { color: colors.mutedForeground, flex: 1 }]}>
            Questions expire. With alerts off you may miss the window to confirm evidence or to
            close an overdue question and take your money back.
          </Text>
        </View>
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
  groupLabel: { marginTop: 28, marginBottom: 4 },
  note: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: 2,
    borderRadius: 2,
    padding: 13,
    marginTop: 26,
  },
});
