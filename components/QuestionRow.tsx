import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';
import { formatNaira } from '@/constants/money';
import type { ActiveQuestion } from '@/contexts/AppContext';

/** One question you paid for, wherever it is listed. */
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
    answered: { tone: colors.primary, label: 'Answered' },
    refunded: { tone: colors.faintForeground, label: 'Closed · refunded' },
  }[question.status];

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
        <Text style={[text.data, { color: colors.faintForeground }]} numberOfLines={1}>
          {question.place?.name ?? 'No place set'}
        </Text>
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
});
