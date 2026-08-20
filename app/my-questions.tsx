import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';
import { useApp } from '@/contexts/AppContext';
import { QuestionRow } from '@/components/QuestionRow';

/** Everything you are still waiting on. Settled ones live in History. */
export default function MyQuestionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeQuestions } = useApp();
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  // Overdue first: it is the only group with a decision waiting on you.
  const overdue = activeQuestions.filter((q) => q.status === 'overdue');
  const underway = activeQuestions.filter((q) => q.status === 'accepted');
  const waiting = activeQuestions.filter((q) => q.status === 'waiting');

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
          Your questions
        </Text>
        <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 6 }]}>
          {activeQuestions.length === 0
            ? 'Nothing in flight right now.'
            : `${activeQuestions.length} still open. Settled ones are in History.`}
        </Text>

        {overdue.length > 0 && (
          <>
            <Text style={[text.label, styles.group, { color: colors.danger }]}>
              Overdue · you can close these
            </Text>
            {overdue.map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                onPress={() => router.push(`/tracking/${q.id}`)}
              />
            ))}
          </>
        )}

        {underway.length > 0 && (
          <>
            <Text style={[text.label, styles.group, { color: colors.accent }]}>
              Someone is going
            </Text>
            {underway.map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                onPress={() => router.push(`/tracking/${q.id}`)}
              />
            ))}
          </>
        )}

        {waiting.length > 0 && (
          <>
            <Text style={[text.label, styles.group, { color: colors.pending }]}>
              Waiting for someone
            </Text>
            {waiting.map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                onPress={() => router.push(`/tracking/${q.id}`)}
              />
            ))}
          </>
        )}

        {activeQuestions.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="help-circle-outline" size={26} color={colors.faintForeground} />
            <Text
              style={[
                text.body,
                { color: colors.mutedForeground, textAlign: 'center', maxWidth: 260 },
              ]}
            >
              When you pay someone to go and check something, it will show up here until it is
              answered.
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
  group: { marginTop: 28, marginBottom: 10 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 70 },
});
