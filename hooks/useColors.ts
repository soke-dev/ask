import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';
import { useThemeModeOptional } from '@/contexts/ThemeContext';

/**
 * Returns the "Signal" design tokens for the active colour scheme: the full
 * palette plus the scheme-independent radius, stroke and spacing scales.
 *
 * Resolution order is the user's explicit choice first, then the device.
 * Note the fallback: Signal is a near-black departure board, so an *unset*
 * system preference resolves to dark rather than to the daylight board.
 * Only an explicit preference for light — from the device or from the
 * in-app setting — switches schemes.
 *
 * Reading the mode is context-optional so this still works above the
 * provider, which is where the error fallback renders.
 */
export function useColors() {
  const system = useColorScheme();
  const mode = useThemeModeOptional()?.mode ?? 'system';

  const isDark = mode === 'system' ? system !== 'light' : mode === 'dark';
  const palette = isDark ? colors.dark : colors.light;

  return {
    ...palette,
    isDark,
    radius: colors.radius,
    stroke: colors.stroke,
    space: colors.space,
  };
}

export type Theme = ReturnType<typeof useColors>;
