import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';
import { formatNaira } from '@/constants/money';
import { useNow } from '@/hooks/useNow';
import type { ActiveQuestion } from '@/contexts/AppContext';

/** One question you paid for, wherever it is listed. */
/** "4m", "1h 20m" — short enough to sit at the end of a line. */
function formatLeft(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function QuestionRow({
  question,
  onPress,
}: {
  question: ActiveQuestion;
  onPress: () => void;
}) {
  const colors = useColors();

  const { tone, label } = {
    waiting: { tone: colors.pending, label: 'Waiting for someone' },
    accepted: { tone: colors.accent, label: 'Someone is going' },
    overdue: { tone: colors.danger, label: 'Overdue · refundable' },
    // Reads as a task, not a result — this row is the asker's to act on.
    delivered: { tone: colors.accent, label: 'Evidence in · check it' },
    answered: { tone: colors.primary, label: 'Answered' },
    // Same amber the verification card uses for a query, so the two screens
    // agree about what a disputed job looks like.
    queried: { tone: colors.pending, label: 'Queried · under review' },
    refunded: { tone: colors.faintForeground, label: 'Closed · refunded' },
  }[question.status];

  /**
   * How long is left, ticking, on the card itself.
   *
   * The clock was only on the tracking screen, so the list gave no sense of
   * urgency — three questions all looking equally patient when one had four
   * minutes on it. Runs from a shared hook rather than a local timer so the
   * countdown cannot drift between rows.
   */
  const deadline =
    question.dispatchedAt === null
      ? null
      : question.dispatchedAt + question.deadlineMinutes * 60_000;

  const now = useNow(deadline ?? undefined);
  const msLeft = deadline === null ? null : deadline - now;

  /**
   * Only while it is genuinely running.
   *
   * A settled or refunded question has no window left to describe, and
   * 'overdue' already says the clock ran out — repeating "0m left" beside it
   * would be a second, worse way of saying the same thing.
   */
  const showClock =
    msLeft !== null &&
    msLeft > 0 &&
    (question.status === 'waiting' || question.status === 'accepted');

  const left = msLeft === null ? '' : formatLeft(msLeft);
  const urgent = msLeft !== null && msLeft < 10 * 60_000;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: colors.border,
          backgroundColor: pressed ? colors.sunken : 'transparent',
        },
      ]}
    >
      <View style={[styles.rail, { backgroundColor: tone }]} />
      <View style={styles.body}>
        <View style={styles.head}>
          <Text style={[text.label, { color: tone, flex: 1 }]}>{label}</Text>
          <Text style={[text.dataMedium, { color: colors.money }]}>
            ₦{formatNaira(question.bounty)}
          </Text>
        </View>
        <Text style={[text.subheading, { color: colors.foreground }]} numberOfLines={2}>
          {question.question}
        </Text>
        <View style={styles.foot}>
          <Text
            style={[text.data, { color: colors.faintForeground, flex: 1 }]}
            numberOfLines={1}
          >
            {question.place?.name ?? 'No place set'}
          </Text>
          {showClock && (
            <Text style={[text.data, { color: urgent ? colors.danger : colors.mutedForeground }]}>
              {left} left
            </Text>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={15} color={colors.faintForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 2,
    marginBottom: 8,
    overflow: 'hidden',
  },
  rail: { width: 4, alignSelf: 'stretch' },
  body: { flex: 1, padding: 13, gap: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
