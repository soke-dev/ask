import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { text } from '@/constants/type';

const BAR = 132;
const DOTS = 3;

type Props = {
  /** Sits beside the dots. `text.action` uppercases it. */
  label: string;
  /** Foreground of the button this sits inside — text and dots both take it. */
  color: string;
};

/**
 * What a transfer looks like while it is in flight.
 *
 * A stock ActivityIndicator would have been a grey donut on a green button,
 * borrowed from a different design language entirely. This is built out of the
 * same parts as the rest of the app: a sweep travelling left to right, which is
 * the direction money is going, and three square lamps in the signage idiom.
 *
 * Both animations are transform and opacity only, so they run on the native
 * driver and keep moving even while the JS thread is busy waiting on the
 * relayer — which is the entire time this is on screen, and exactly when a
 * JS-driven animation would stutter and look broken.
 */
export function SendingIndicator({ label, color }: Props) {
  const [width, setWidth] = useState(0);
  const [still, setStill] = useState(false);

  const sweep = useRef(new Animated.Value(0)).current;
  const dots = useRef(
    Array.from({ length: DOTS }, () => new Animated.Value(0.28)),
  ).current;

  /**
   * An indefinite loop is the exact thing Reduce Motion is turned on to stop.
   * The label still says what is happening, so nothing is lost by holding the
   * dots at full strength and leaving the sweep off.
   */
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) setStill(on);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (still || width === 0) return;

    const run = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1150,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    run.start();
    return () => run.stop();
  }, [sweep, still, width]);

  useEffect(() => {
    if (still) {
      dots.forEach((d) => d.setValue(1));
      return;
    }

    // Staggered rather than simultaneous: three lamps blinking together is a
    // warning, three in sequence is progress.
    const runs = dots.map((value, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(value, {
            toValue: 1,
            duration: 240,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0.28,
            duration: 400,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay((DOTS - 1 - i) * 150),
        ]),
      ),
    );
    runs.forEach((r) => r.start());
    return () => runs.forEach((r) => r.stop());
  }, [dots, still]);

  return (
    <>
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {!still && width > 0 && (
          <Animated.View
            style={[
              styles.bar,
              {
                transform: [
                  {
                    translateX: sweep.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-BAR, width],
                    }),
                  },
                ],
              },
            ]}
          >
            <LinearGradient
              // A highlight passing over the button, not a block sliding
              // across it: hard edges would read as a second element.
              colors={['transparent', 'rgba(255,255,255,0.26)', 'transparent']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        )}
      </View>

      <View style={styles.row}>
        <Text style={[text.action, { color }]}>{label}</Text>
        <View style={styles.dots}>
          {dots.map((value, i) => (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: color,
                  opacity: value,
                  transform: [
                    {
                      scaleY: value.interpolate({
                        inputRange: [0.28, 1],
                        outputRange: [0.6, 1],
                      }),
                    },
                  ],
                },
              ]}
            />
          ))}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', top: 0, bottom: 0, width: BAR },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  // Squares, not circles — the rest of the app rounds to 2px or not at all.
  dots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 1 },
});
