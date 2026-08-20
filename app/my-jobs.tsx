import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';
import { formatNaira, verifierCut } from '@/constants/money';
import { useApp } from '@/contexts/AppContext';
import { JobRow } from '@/components/JobRow';

/** Jobs you have taken and not yet finished. Paid ones live in History. */
export default function MyJobsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeJobs } = useApp();
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  const owed = activeJobs.reduce((sum, task) => sum + verifierCut(task.reward), 0);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: topPad }]}
      >
        <Pressable
          onPress={() => router.back()}
          style={[styles.backBtn, { borderColor: colors.border }]}
        >
          <Ionicons name="arrow-back" size={18} color={colors.foreground} />
        </Pressable>

        <Text style={[text.display, { color: colors.foreground, marginTop: 22 }]}>Your jobs</Text>
        <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 6 }]}>
          {activeJobs.length === 0
            ? 'You have not taken any jobs yet.'
            : `${activeJobs.length} to finish · ₦${formatNaira(owed)} waiting on you.`}
        </Text>

        <View style={{ marginTop: 24 }}>
          {activeJobs.map((task) => (
            <JobRow key={task.id} task={task} onPress={() => router.push(`/task/${task.id}`)} />
          ))}
        </View>

        {activeJobs.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="footsteps-outline" size={26} color={colors.faintForeground} />
            <Text
              style={[
                text.body,
                { color: colors.mutedForeground, textAlign: 'center', maxWidth: 270 },
              ]}
            >
              Take a job from the Earn board and it stays here, locked to you, until you send the
              evidence.
            </Text>
            <Pressable
              onPress={() => router.replace('/(tabs)/earn')}
              style={({ pressed }) => [
                styles.findBtn,
                { backgroundColor: colors.foreground, opacity: pressed ? 0.88 : 1 },
              ]}
            >
              <Text style={[text.action, { color: colors.background }]}>Find work</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 44 },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { alignItems: 'center', gap: 14, paddingVertical: 60 },
  findBtn: { borderRadius: 2, paddingVertical: 14, paddingHorizontal: 26, marginTop: 4 },
});
