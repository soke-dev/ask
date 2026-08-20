import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';
import { formatNaira, verifierCut } from '@/constants/money';
import { stateForArea, type NearbyTask } from '@/contexts/AppContext';

function countdown(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * A job on the board, in three lines: where it is and what it pays, what is
 * being asked, then how far and how long is left. Anything more turns a list
 * meant to be scanned into a stack of documents.
 */
export function TaskCard({ task, onPress }: { task: NearbyTask; onPress: () => void }) {
  const colors = useColors();
  const state = stateForArea(task.area);
  const urgent = task.expiresIn < 300;

  const categoryTint = {
    fuel: colors.catFuel,
    food: colors.catFood,
    traffic: colors.catTraffic,
    shopping: colors.catShopping,
    safety: colors.catSafety,
  }[task.category];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: pressed ? colors.borderStrong : colors.border,
        },
      ]}
    >
      {/* Category colour lives on the edge, like a route stripe */}
      <View style={[styles.rail, { backgroundColor: categoryTint }]} />

      <View style={styles.inner}>
        <View style={styles.topRow}>
          <Text style={[text.label, { color: categoryTint, flex: 1 }]} numberOfLines={1}>
            {task.category} · {task.area}
            {state ? `, ${state}` : ''}
          </Text>
          {task.verifiedOnly && (
            <Ionicons name="shield-checkmark" size={13} color={colors.primary} />
          )}
          <Text style={[text.amount, { color: colors.money, fontSize: 16 }]}>
            ₦{formatNaira(verifierCut(task.reward))}
          </Text>
        </View>

        <Text style={[text.heading, { color: colors.foreground }]} numberOfLines={2}>
          {task.title}
        </Text>

        <View style={styles.footRow}>
          <Text style={[text.data, { color: colors.mutedForeground, flex: 1 }]} numberOfLines={1}>
            {task.location}
          </Text>
          <Text style={[text.data, { color: colors.faintForeground }]}>{task.distance}</Text>
          <Text style={[text.data, { color: urgent ? colors.danger : colors.faintForeground }]}>
            · {countdown(task.expiresIn)}
          </Text>
          <Ionicons name="arrow-forward" size={13} color={colors.foreground} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderWidth: 2,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  rail: { width: 4 },
  inner: { flex: 1, paddingHorizontal: 13, paddingVertical: 11, gap: 5 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
});
