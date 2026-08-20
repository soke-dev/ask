import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';

/**
 * A labelled switch. Every preference in the app reads the same way, so the
 * control lives in one place rather than being redrawn per screen.
 */
export function SettingToggle({
  label,
  detail,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const colors = useColors();

  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            text.subheading,
            { color: disabled ? colors.faintForeground : colors.foreground },
          ]}
        >
          {label}
        </Text>
        <Text style={[text.data, { color: colors.faintForeground, marginTop: 2 }]}>{detail}</Text>
      </View>

      <Pressable
        onPress={() => !disabled && onChange(!value)}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
        accessibilityLabel={label}
        style={[
          styles.toggle,
          {
            backgroundColor: value ? colors.primary : colors.sunken,
            borderColor: value ? colors.primary : colors.borderStrong,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        <View
          style={[
            styles.knob,
            {
              backgroundColor: value ? colors.primaryForeground : colors.mutedForeground,
              alignSelf: value ? 'flex-end' : 'flex-start',
            },
          ]}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    borderBottomWidth: 1,
  },
  toggle: { width: 46, height: 26, borderWidth: 2, borderRadius: 2, padding: 2, flexShrink: 0 },
  knob: { width: 18, height: 18, borderRadius: 1 },
});
