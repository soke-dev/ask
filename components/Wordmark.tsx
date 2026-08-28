import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

/**
 * The mark, from the same file the app icon is cut from.
 *
 * Drawn in SVG at first, which was a mistake: two definitions of one logo
 * drift the moment either is touched, and the drawn one was already a
 * different shape from the artwork by the time it was noticed. This renders
 * `confamlogo.png` — the master — so the thing on the home screen and the
 * thing at the top of the app cannot disagree.
 */
export function ConfamMark({ size = 30 }: { size?: number }) {
  return (
    <Image
      source={require('@/assets/images/confamlogo.png')}
      style={[styles.mark, { width: size, height: size, borderRadius: Math.round(size * 0.22) }]}
      resizeMode="contain"
      accessible={false}
    />
  );
}

/**
 * The full lockup: the mark, then the name.
 *
 * "Confam" is what somebody says when a thing has been checked and is true, so
 * the name is the product description. Set in the uppercase tracked style the
 * app already uses for anything authoritative — this is a sign, not a logo
 * trying to be friendly.
 */
export function Wordmark({ size = 22, showMark = true }: { size?: number; showMark?: boolean }) {
  const colors = useColors();

  return (
    <View style={styles.row}>
      {showMark && <ConfamMark size={size * 1.35} />}
      <Text
        style={[
          styles.word,
          {
            color: colors.foreground,
            fontSize: size,
            // Tracking scales with the type: a fixed value that reads as
            // signage at 22 looks like a mistake at 44.
            letterSpacing: size * 0.075,
          },
        ]}
      >
        CONFAM
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  // The artwork is a square plate; rounding it here matches how every OS
  // presents it and stops it reading as a screenshot of the icon.
  mark: { overflow: 'hidden' },
  // Weight rather than a named family: this renders before the custom faces
  // have registered on a cold start, and a wordmark that reflows once the font
  // arrives is worse than one that never moves.
  word: { fontWeight: '800' },
});
