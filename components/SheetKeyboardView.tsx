import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { KeyboardAvoidingView, KeyboardProvider } from 'react-native-keyboard-controller';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Keyboard avoidance that survives being inside a `Modal`.
 *
 * React Native's own KeyboardAvoidingView was doing nothing on Android here,
 * for two compounding reasons:
 *
 * 1. It was passed `behavior={undefined}` on Android, on the usual assumption
 *    that `adjustResize` handles it. A Modal is its own window, and the
 *    activity's soft-input mode does not reach into it — so nothing resized
 *    and nothing moved.
 * 2. Android 15 deprecates `adjustResize` under edge-to-edge, which SDK 54
 *    turns on by default. Even outside a Modal that assumption is expiring.
 *
 * react-native-keyboard-controller reads WindowInsets directly rather than
 * relying on the window resizing, which is why it works in both places. Its
 * provider is per-window, so the one in the root layout does not cover a
 * Modal's window and a nested one is required — that is what the library's
 * own Modal guidance says to do, and the translucency flags have to match the
 * ones set on the Modal or the insets are measured against the wrong bounds.
 *
 * It fills by default, and that is load-bearing rather than tidiness. The
 * provider renders a flex:1 container of its own, so it fills the backdrop and
 * the backdrop's justifyContent stops deciding anything. Whatever this returns
 * is then positioned inside the provider, which justifies to flex-start — so a
 * caller passing only justifyContent, with no flex, gets a bottom sheet pinned
 * to the top of the screen under the status bar, and a centred dialog pinned
 * there too. Three of the five callers had flex:1 and worked; two did not and
 * were wrong on screen. Guaranteeing it here means the next caller cannot get
 * it wrong, and a caller that genuinely wants to hug its content can still say
 * so, because their style is applied second.
 */
export function SheetKeyboardView({ children, style }: Props) {
  // The library is native-only; a browser moves the page itself.
  if (Platform.OS === 'web') {
    return <View style={[styles.fill, style]}>{children}</View>;
  }

  return (
    <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={[styles.fill, style]}>
        {children}
      </KeyboardAvoidingView>
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
