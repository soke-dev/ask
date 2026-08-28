import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useNow } from '@/hooks/useNow';
import { text } from '@/constants/type';
import { formatNaira, verifierCut } from '@/constants/money';
import { stateForArea, type NearbyTask } from '@/contexts/AppContext';

/**
 * Time left, from the deadline rather than from a counter.
 *
 * This used to format `expiresIn` as seconds — but that value arrives from
 * the server in minutes, so a thirty-minute job rendered as "0:30" and ran
 * out in half a minute.
 */
function remaining(expiresAt: number, now: number): string {
  const ms = Math.max(0, expiresAt - now);
  const minutes = Math.floor(ms / 60_000);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes >= 1) return `${minutes}m`;
  return `${Math.floor(ms / 1000)}s`;
}

/**
 * A job on the board, in three lines: where it is and what it pays, what is
 * being asked, then how far and how long is left. Anything more turns a list
 * meant to be scanned into a stack of documents.
 */
export function TaskCard({ task, onPress }: { task: NearbyTask; onPress: () => void }) {
  const colors = useColors();
  // The server's state when there is one, derived from the area otherwise —
  // a place name alone is ambiguous across Nigeria.
  const state = task.state || stateForArea(task.area);
  // Under ten minutes. Compared in milliseconds against the deadline, not in
  // whatever unit a counter happened to hold — the old check read minutes as
  // seconds and marked almost every job urgent.
  // Ticks itself, so the countdown moves without waiting for the list to
  // re-render for some other reason.
  const now = useNow(task.expiresAt);
  const urgent = task.expiresAt - now < 10 * 60_000;

  const categoryTint = {
    housing: colors.catHousing,
    fuel: colors.catFuel,
    food: colors.catFood,
    traffic: colors.catTraffic,
    shopping: colors.catShopping,
    other: colors.catOther,
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
            · {remaining(task.expiresAt, now)}
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
