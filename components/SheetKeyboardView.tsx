import React from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
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
 */
export function SheetKeyboardView({ children, style }: Props) {
  // The library is native-only; a browser moves the page itself.
  if (Platform.OS === 'web') {
    return <View style={style}>{children}</View>;
  }

  return (
    <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={style}>
        {children}
      </KeyboardAvoidingView>
    </KeyboardProvider>
  );
}
