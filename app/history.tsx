import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import { formatNaira, verifierCut } from '@/constants/money';
import { useApp } from '@/contexts/AppContext';
import { QuestionRow } from '@/components/QuestionRow';
import { JobRow } from '@/components/JobRow';

type Side = 'asked' | 'earned';

/** Everything that is finished, split by which side of it you were on. */
export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { answeredQuestions, completedJobs } = useApp();
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  const [side, setSide] = useState<Side>('asked');

  const spent = answeredQuestions.reduce((sum, q) => sum + q.bounty, 0);
  const earned = completedJobs.reduce((sum, t) => sum + verifierCut(t.reward), 0);

  const rows = side === 'asked' ? answeredQuestions.length : completedJobs.length;

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

        <Text style={[text.display, { color: colors.foreground, marginTop: 22 }]}>History</Text>

        {/* Two sides of the same account, so they get one control rather
            than two separate screens. */}
        <View style={[styles.segmented, { borderColor: colors.borderStrong }]}>
          {(
            [
              { key: 'asked', label: 'Asked', total: `₦${formatNaira(spent)} spent` },
              { key: 'earned', label: 'Earned', total: `₦${formatNaira(earned)} earned` },
            ] as const
          ).map((tab, i) => {
            const on = side === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setSide(tab.key)}
                style={[
                  styles.segment,
                  i > 0 && { borderLeftWidth: 2, borderLeftColor: colors.borderStrong },
                  on && { backgroundColor: colors.foreground },
                ]}
              >
                <Text
                  style={[
                    text.action,
                    { fontSize: 12, color: on ? colors.background : colors.mutedForeground },
                  ]}
                >
                  {tab.label}
                </Text>
                <Text
                  style={[
                    text.data,
                    { color: on ? colors.background : colors.faintForeground },
                  ]}
                >
                  {tab.total}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ marginTop: 24 }}>
          {side === 'asked'
            ? answeredQuestions.map((q) => (
                <QuestionRow
                  key={q.id}
                  question={q}
                  onPress={() => router.push(`/tracking/${q.id}`)}
                />
              ))
            : completedJobs.map((task) => (
                <JobRow
                  key={task.id}
                  task={task}
                  done
                  onPress={() => router.push(`/task/${task.id}`)}
                />
              ))}
        </View>

        {rows === 0 && (
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={26} color={colors.faintForeground} />
            <Text
              style={[
                text.body,
                { color: colors.mutedForeground, textAlign: 'center', maxWidth: 270 },
              ]}
            >
              {side === 'asked'
                ? 'Questions you have paid for and had answered will be listed here.'
                : 'Jobs you have finished and been paid for will be listed here.'}
            </Text>
          </View>
        )}

        <Text style={[text.data, styles.footNote, { color: colors.faintForeground }]}>
          Every naira in and out is also itemised on the wallet in{' '}
          <Text style={{ fontFamily: font.monoSemi, color: colors.mutedForeground }}>You</Text>.
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
  segmented: {
    flexDirection: 'row',
    borderWidth: 2,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 20,
  },
  segment: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 12 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 60 },
  footNote: { marginTop: 28, lineHeight: 17 },
});
