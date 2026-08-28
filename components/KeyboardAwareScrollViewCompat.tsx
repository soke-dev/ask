import React, { forwardRef } from 'react';
import { Platform, ScrollView, ScrollViewProps } from 'react-native';
import {
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewProps,
} from 'react-native-keyboard-controller';

type Props = KeyboardAwareScrollViewProps & ScrollViewProps;

/**
 * A ScrollView that scrolls whatever has focus out from behind the keyboard.
 *
 * React Native's own does not, on either platform — the window resizing (or
 * not) is the whole of its keyboard behaviour, and a field below the fold
 * stays below it. This one measures the focused input and scrolls to it.
 *
 * Refs are forwarded because callers hold one to drive scrollTo, and swapping
 * a plain ScrollView for this must not quietly break that.
 */
export const KeyboardAwareScrollViewCompat = forwardRef<ScrollView, Props>(
  function KeyboardAwareScrollViewCompat(
    { children, keyboardShouldPersistTaps = 'handled', ...props },
    ref,
  ) {
    if (Platform.OS === 'web') {
      return (
        <ScrollView ref={ref} keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
          {children}
        </ScrollView>
      );
    }

    return (
      <KeyboardAwareScrollView
        ref={ref}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...props}
      >
        {children}
      </KeyboardAwareScrollView>
    );
  },
);
