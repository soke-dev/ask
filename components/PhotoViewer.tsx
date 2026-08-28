import React from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { text } from '@/constants/type';

const AnimatedImage = Animated.createAnimatedComponent(Image);

const MAX_SCALE = 5;
/** Anything below this snaps back — a pinch that small is usually a stray touch. */
const MIN_SCALE = 1;

type Props = {
  visible: boolean;
  uri: string | null;
  /** Shown in the corner, e.g. "12m from the place". */
  caption?: string | null;
  onClose: () => void;
};

/**
 * Evidence at the size of the screen, with pinch and pan.
 *
 * The card and the details page both show a photo about 260px tall, which is
 * enough to see that something was sent and not enough to check it. An asker
 * deciding whether a queue is real, or whether a sign says what it should,
 * needs to get close to it — so this is the whole screen, and it zooms.
 *
 * Built on gesture-handler and reanimated, which are already linked into the
 * app for the keyboard and the drawer. No new native module, and so no rebuild
 * to use it.
 */
export function PhotoViewer({ visible, uri, caption, onClose }: Props) {
  const insets = useSafeAreaInsets();

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    x.value = withTiming(0);
    y.value = withTiming(0);
    savedX.value = 0;
    savedY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(0.6, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value < MIN_SCALE) {
        reset();
        return;
      }
      savedScale.value = scale.value;
    });

  /**
   * Panning only bites once zoomed in.
   *
   * At 1× the image already fits, so dragging it would move a picture that has
   * nowhere to go and make the viewer feel loose.
   */
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (savedScale.value <= 1) return;
      x.value = savedX.value + e.translationX;
      y.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = x.value;
      savedY.value = y.value;
    });

  /** Double tap toggles between fit and 2.5×, centred where they tapped. */
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1) {
        reset();
        return;
      }
      scale.value = withTiming(2.5);
      savedScale.value = 2.5;
    });

  /** A single tap closes, but only while the image is not zoomed. */
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      if (savedScale.value <= 1) runOnJS(onClose)();
    });

  const gesture = Gesture.Simultaneous(
    pinch,
    pan,
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
      // Reset on the way in, so reopening never starts mid-zoom from last time.
      onShow={reset}
    >
      <View style={styles.screen}>
        <GestureDetector gesture={gesture}>
          <View style={styles.stage} collapsable={false}>
            {uri && (
              <AnimatedImage
                source={{ uri }}
                style={[styles.image, imageStyle]}
                contentFit="contain"
                transition={120}
              />
            )}
          </View>
        </GestureDetector>

        <Pressable
          onPress={onClose}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Close the photo"
          style={[
            styles.close,
            { top: (Platform.OS === 'web' ? 16 : insets.top) + 10 },
          ]}
        >
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>

        <View style={[styles.foot, { paddingBottom: insets.bottom + 18 }]} pointerEvents="none">
          <Text style={[text.data, styles.footText]}>
            {caption ? `${caption} · pinch to zoom` : 'Pinch to zoom · tap to close'}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Black rather than the theme's background: nothing should compete with the
  // photograph, in either theme.
  screen: { flex: 1, backgroundColor: '#000000' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  close: {
    position: 'absolute',
    right: 16,
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  footText: { color: 'rgba(255,255,255,0.6)' },
});
