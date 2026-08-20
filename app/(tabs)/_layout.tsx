import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';

/**
 * Three tabs, not four. The old layout had a Home tab whose "I want to
 * Ask / I want to Earn" switcher duplicated what the Ask and Verify tabs
 * already did — two controls for one decision. Home is folded into Ask,
 * and the tabs themselves are now the mode switch.
 */
const TABS: Record<
  string,
  { label: string; icon: keyof typeof Ionicons.glyphMap; tint: 'accent' | 'primary' | 'ink' }
> = {
  index: { label: 'Ask', icon: 'sparkles', tint: 'accent' },
  earn: { label: 'Earn', icon: 'footsteps', tint: 'primary' },
  you: { label: 'You', icon: 'person', tint: 'ink' },
};

function SignalTabBar({ state, navigation }: BottomTabBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: (Platform.OS === 'web' ? 10 : insets.bottom) + 10,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const meta = TABS[route.name];
        if (!meta) return null;

        const focused = state.index === index;
        const tint =
          meta.tint === 'accent'
            ? colors.accent
            : meta.tint === 'primary'
              ? colors.primary
              : colors.foreground;
        // Selected reads as an illuminated block, the way a board lights a
        // row — solid signal fill, ground-coloured text knocked out of it.
        const onTint =
          meta.tint === 'accent'
            ? colors.accentForeground
            : meta.tint === 'primary'
              ? colors.primaryForeground
              : colors.background;

        function onPress() {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            if (Platform.OS !== 'web') Haptics.selectionAsync();
            navigation.navigate(route.name);
          }
        }

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={meta.label}
            style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.65 : 1 }]}
          >
            <View
              style={[
                styles.pill,
                focused
                  ? { backgroundColor: tint }
                  : { borderWidth: 2, borderColor: colors.border },
              ]}
            >
              <Ionicons
                name={meta.icon}
                size={16}
                color={focused ? onTint : colors.faintForeground}
              />
              <Text
                style={[
                  text.action,
                  styles.label,
                  { color: focused ? onTint : colors.faintForeground },
                ]}
              >
                {meta.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <SignalTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: 'Ask' }} />
      <Tabs.Screen name="earn" options={{ title: 'Earn' }} />
      <Tabs.Screen name="you" options={{ title: 'You' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 10,
    paddingHorizontal: 12,
    gap: 6,
  },
  tab: { flex: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 2,
  },
  label: { fontSize: 12 },
});
