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
  const { activeJobs, deliveredJobs, queriedJobs } = useApp();

  // Only the ones still to walk to. The other two are waiting on somebody else.
  const walking = activeJobs.filter((t) => !deliveredJobs.some((d) => d.id === t.id));
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  // Only what is still to be walked to. Delivered work is not owed to you yet.
  const owed = walking.reduce((sum, task) => sum + verifierCut(task.reward), 0);
  const total = walking.length + deliveredJobs.length + queriedJobs.length;

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
          {total === 0
            ? 'You have not taken any jobs yet.'
            : `${total} open · ₦${formatNaira(owed)} still to earn.`}
        </Text>

        {/* Grouped by who the job is waiting on, which is the only thing that
            changes what you can do about it. */}
        {walking.length > 0 && (
          <>
            <Text style={[text.label, styles.group, { color: colors.accent }]}>
              Go and look
            </Text>
            {walking.map((task) => (
              <JobRow key={task.id} task={task} onPress={() => router.push(`/task/${task.id}`)} />
            ))}
          </>
        )}

        {deliveredJobs.length > 0 && (
          <>
            <Text style={[text.label, styles.group, { color: colors.pending }]}>
              Sent · waiting on the asker
            </Text>
            {deliveredJobs.map((task) => (
              <JobRow key={task.id} task={task} onPress={() => router.push(`/task/${task.id}`)} />
            ))}
          </>
        )}

        {queriedJobs.length > 0 && (
          <>
            <Text style={[text.label, styles.group, { color: colors.danger }]}>
              Queried · with a reviewer
            </Text>
            {queriedJobs.map((task) => (
              <JobRow key={task.id} task={task} onPress={() => router.push(`/task/${task.id}`)} />
            ))}
          </>
        )}

        {total === 0 && (
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
  group: { marginTop: 26, marginBottom: 10 },
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
