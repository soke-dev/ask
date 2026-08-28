import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';
import { formatNaira, verifierCut } from '@/constants/money';
import type { NearbyTask } from '@/contexts/AppContext';

/**
 * One job you took, wherever it is listed. `done` switches it from something
 * to finish into a record of something finished.
 */
export function JobRow({
  task,
  onPress,
  done = false,
}: {
  task: NearbyTask;
  onPress: () => void;
  done?: boolean;
}) {
  const colors = useColors();
  const tone = done ? colors.primary : colors.accent;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: tone,
          backgroundColor: pressed
            ? colors.sunken
            : done
              ? 'transparent'
              : colors.accentSoft,
        },
      ]}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[text.heading, { color: colors.foreground }]} numberOfLines={1}>
          {task.title}
        </Text>
        <Text style={[text.data, { color: colors.mutedForeground }]} numberOfLines={1}>
          {task.location}
        </Text>
      </View>

      <View style={styles.right}>
        <Text style={[text.amount, { color: colors.money, fontSize: 16 }]}>
          ₦{formatNaira(verifierCut(task.reward))}
        </Text>
        {/* Three states, not two. A submitted job said "Finish", which reads
            as unfinished work and sends somebody back to a capture screen for
            evidence they already sent. */}
        <Text style={[text.data, { color: tone }]}>
          {done
            ? 'Paid'
            : task.serverStatus === 'submitted'
              ? 'With the asker'
              : 'Finish'}
        </Text>
      </View>

      {done ? (
        <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.accent} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 8,
  },
  right: { alignItems: 'flex-end' },
});
