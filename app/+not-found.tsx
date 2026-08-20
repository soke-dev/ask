import { Link, Stack } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';

export default function NotFoundScreen() {
  const colors = useColors();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[text.label, { color: colors.faintForeground }]}>Nothing here</Text>
        <Text style={[text.display, { color: colors.foreground, textAlign: 'center' }]}>
          That page went{'\n'}for a walk.
        </Text>
        <Text
          style={[
            text.body,
            { color: colors.mutedForeground, textAlign: 'center', maxWidth: 280 },
          ]}
        >
          The screen you were looking for does not exist.
        </Text>

        <Link href="/" asChild>
          <Pressable
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: colors.foreground, opacity: pressed ? 0.88 : 1 },
            ]}
          >
            <Text style={[text.action, { color: colors.background }]}>Back to Ask</Text>
          </Pressable>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  btn: {
    borderRadius: 2,
    paddingVertical: 15,
    paddingHorizontal: 30,
    marginTop: 20,
  },
});
