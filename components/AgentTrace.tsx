import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';

export type TraceStep = {
  label: string;
  status: 'pending' | 'active' | 'complete';
};

function Breathing({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.2, duration: 620, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 620, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return <Animated.View style={[styles.liveMark, { opacity, backgroundColor: color }]} />;
}

/**
 * The work log for a question in progress.
 *
 * Deliberately not framed as "agent reasoning" — it is a numbered list of
 * things being checked, in plain language, the way a person would list what
 * they had tried.
 */
export function AgentTrace({ steps }: { steps: TraceStep[] }) {
  const colors = useColors();
  const done = steps.filter((s) => s.status === 'complete').length;

  return (
    <View>
      <View style={styles.head}>
        <Text style={[text.label, { color: colors.faintForeground }]}>Working on it</Text>
        <Text style={[text.data, { color: colors.faintForeground }]}>
          {done}/{steps.length}
        </Text>
      </View>

      {steps.map((step, i) => {
        const isComplete = step.status === 'complete';
        const isActive = step.status === 'active';

        return (
          <View key={i} style={styles.row}>
            <View style={styles.gutter}>
              <View
                style={[
                  styles.marker,
                  {
                    borderColor: isComplete
                      ? colors.primary
                      : isActive
                        ? colors.accent
                        : colors.border,
                    backgroundColor: isComplete ? colors.primary : 'transparent',
                  },
                ]}
              >
                {isComplete ? (
                  <Ionicons name="checkmark" size={11} color={colors.primaryForeground} />
                ) : isActive ? (
                  <Breathing color={colors.accent} />
                ) : null}
              </View>
              {i < steps.length - 1 && (
                <View
                  style={[
                    styles.thread,
                    { backgroundColor: isComplete ? colors.primary : colors.border },
                  ]}
                />
              )}
            </View>

            <View style={styles.body}>
              <Text style={[text.data, styles.index, { color: colors.faintForeground }]}>
                {String(i + 1).padStart(2, '0')}
              </Text>
              <Text
                style={[
                  text.body,
                  {
                    flex: 1,
                    color: isActive
                      ? colors.foreground
                      : isComplete
                        ? colors.mutedForeground
                        : colors.faintForeground,
                    fontFamily: isActive ? font.sansMedium : font.sans,
                  },
                ]}
              >
                {step.label}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  row: { flexDirection: 'row', gap: 12 },
  gutter: { alignItems: 'center', width: 20 },
  marker: {
    width: 20,
    height: 20,
    borderRadius: 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveMark: { width: 7, height: 7, borderRadius: 0 },
  thread: { width: 1.5, flex: 1, minHeight: 14, marginVertical: 3 },
  body: { flex: 1, flexDirection: 'row', gap: 10, paddingBottom: 18 },
  index: { paddingTop: 3 },
});
