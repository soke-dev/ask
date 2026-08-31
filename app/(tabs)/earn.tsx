import React, { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import { isJobNearArea, useApp } from '@/contexts/AppContext';
import { useRefreshOnFocus } from '@/hooks/useRefreshOnFocus';
import {
  JobFilterSheet,
  NO_FILTERS,
  activeFilterCount,
  matchesFilters,
  sortJobs,
  type JobFilters,
} from '@/components/JobFilterSheet';
import { useLocalSearchParams } from 'expo-router';
import { formatNaira, verifierCut } from '@/constants/money';
import { TaskCard } from '@/components/TaskCard';
import { JobRow } from '@/components/JobRow';

/**
 * One flat, mutually exclusive list rather than two stacked controls.
 * "Near me" leads because a job you cannot reach is not a job — the rest of
 * the country is one tap away under "All".
 */
// Ordered by how often somebody is likely to want it, not alphabetically.
// 'Other' sits last because it is the leftovers, not a subject.
const FILTERS = [
  'Near me',
  'All',
  'Housing',
  'Traffic',
  'Food',
  'Fuel',
  'Shopping',
  'Safety',
  'Other',
] as const;
type Filter = (typeof FILTERS)[number];

export default function EarnScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    nearbyTasks,
    activeJobs,
    homeArea,
    locationFilter,
    setLocationFilter,
    disputes,
    refreshJobs,
    refreshMyJobs,
    refreshDisputes,
    deliveredJobs,
    queriedJobs,
  } = useApp();

  /**
   * Everything My jobs will list, not just what is left to walk to.
   *
   * The button counted activeJobs while the screen behind it also shows sent
   * and queried work, so tapping "View all 1" landed on a list of three.
   */
  const openJobs = activeJobs.length + deliveredJobs.length + queriedJobs.length;

  /**
   * The board is other people's work, so this screen cannot know when it
   * changes — only when somebody is looking at it. Both lists, because a job
   * that leaves the board because you took it has to arrive in the other one.
   */
  useRefreshOnFocus(
    useCallback(
      // Disputes too: a query raised against your answer is work waiting on
      // you, and it arrives from the other person's device, never yours.
      () => Promise.all([refreshJobs(), refreshMyJobs(), refreshDisputes()]),
      [refreshJobs, refreshMyJobs, refreshDisputes],
    ),
  );

  /**
   * Queries waiting on *you as the verifier*, which is what Earn is about.
   *
   * Without the role test this counted the asker's own queries too, so raising
   * one put a banner on your own Earn tab telling you an answer of yours had
   * been queried and asking you to reply to yourself.
   */
  const openQueries = disputes.filter(
    (d) => d.status === 'awaiting_verifier' && d.role === 'verifier',
  ).length;

  /**
   * Answered, and still not over.
   *
   * Replying moves a query to 'awaiting_admin', which took it out of the count
   * above and off this tab entirely — so a verifier who had just written their
   * side watched it disappear with nothing to say it had been received. This
   * is not something to act on, it is somewhere for it to still exist.
   */
  const waitingOnReviewer = disputes.filter(
    (d) => d.status === 'awaiting_admin' && d.role === 'verifier',
  ).length;
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  /**
   * Opens on Near me when arrived at from the "jobs around you" tile.
   *
   * The tile states a number for one particular area, so landing on whatever
   * filter was last used would show a different list than the one tapped.
   * Near me is also the default, so this only matters when the filter was
   * changed earlier in the session.
   */
  const { filter: filterParam } = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<Filter>('Near me');

  /**
   * The narrower filters, kept apart from the category chips.
   *
   * The chips answer "what kind of job"; these answer "where, for how much,
   * and how long have I got". Different questions, and combining them into one
   * row would have meant a chip per state.
   */
  const [filters, setFilters] = useState<JobFilters>(NO_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const narrowed = activeFilterCount(filters);

  useEffect(() => {
    if (filterParam === 'near') setFilter('Near me');
  }, [filterParam]);

  /**
   * Where "near me" means: the home area on your profile.
   *
   * There was a picker here for browsing another city, and it stopped making
   * sense the moment taking a job required standing at the place. Choosing
   * "Ikeja" from Surulere offered a list of jobs the server would refuse, so
   * the control promised something the rules do not allow.
   *
   * `locationFilter` is still read because app state still carries it; nothing
   * on this screen sets it any more.
   */
  const nearLabel = locationFilter?.label ?? homeArea?.label ?? '';

  const available = sortJobs(
    nearbyTasks.filter((t) => {
      if (t.status !== 'available') return false;

      // Both sets apply: a category chip and a state are an "and", not a choice.
      if (!matchesFilters(t, filters)) return false;

      if (filter === 'Near me') return isJobNearArea(t, nearLabel);
      if (filter === 'All') return true;
      return t.category.toLowerCase() === filter.toLowerCase();
    }),
    filters.sort,
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: topPad }]}
      >
        {/* ── Header ───────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[text.display, { color: colors.foreground }]}>Earn</Text>
            <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 2 }]}>
              {/* No mention of the chain. It is how the money moves, not what
                  the person is being asked to do, and naming it here made a
                  walk to a filling station sound like a crypto errand. */}
              Go there, send proof, get paid when the asker confirms.
            </Text>
          </View>
        </View>

        {/* ── Jobs you have taken ──────────────────────────────────
            These leave the board below the moment they are accepted, so
            without this they would be unreachable after navigating away. */}
        {activeJobs.length > 0 && (
          <>
            <View style={styles.mineHead}>
              <Text style={[text.label, { color: colors.accent, flex: 1 }]}>
                You are doing this
              </Text>
              <Text style={[text.data, { color: colors.faintForeground }]}>
                {activeJobs.length}
              </Text>
            </View>

            {/* Preview only — the full list is a tap away. */}
            {activeJobs.slice(0, 2).map((task) => (
              <JobRow key={task.id} task={task} onPress={() => router.push(`/task/${task.id}`)} />
            ))}

            <Pressable
              onPress={() => router.push('/my-jobs')}
              style={({ pressed }) => [
                styles.viewAll,
                { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[text.action, { color: colors.foreground }]}>
                View all {openJobs}
              </Text>
              <Ionicons name="arrow-forward" size={14} color={colors.foreground} />
            </Pressable>
          </>
        )}

        {waitingOnReviewer > 0 && (
          <Pressable
            onPress={() => router.push('/disputes')}
            style={({ pressed }) => [
              styles.queryBanner,
              { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="hourglass-outline" size={16} color={colors.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text style={[text.subheading, { color: colors.foreground }]}>
                {waitingOnReviewer === 1
                  ? 'Your answer is with a reviewer'
                  : `${waitingOnReviewer} answers are with a reviewer`}
              </Text>
              <Text style={[text.data, { color: colors.faintForeground }]}>
                You have replied · nothing more to do
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.faintForeground} />
          </Pressable>
        )}

        {/* Queries need answering before anything else on this tab. */}
        {openQueries > 0 && (
          <Pressable
            onPress={() => router.push('/disputes')}
            style={({ pressed }) => [
              styles.queryBanner,
              { borderColor: colors.pending, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Ionicons name="alert-circle" size={17} color={colors.pending} />
            <View style={{ flex: 1 }}>
              <Text style={[text.heading, { color: colors.pending }]}>
                {openQueries === 1 ? 'An answer was queried' : `${openQueries} answers queried`}
              </Text>
              <Text style={[text.data, { color: colors.mutedForeground }]}>
                Reply before a reviewer decides
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.pending} />
          </Pressable>
        )}

        {/* ── Filters ──────────────────────────────────────────────── */}
        {/* Outside the horizontal scroller so it cannot scroll out of reach —
            the row it sits beside is longer than the screen. */}
        <Pressable
          onPress={() => setFilterOpen(true)}
          style={({ pressed }) => [
            styles.filterBtn,
            {
              borderColor: narrowed > 0 ? colors.foreground : colors.border,
              backgroundColor: narrowed > 0 ? colors.sunken : 'transparent',
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="options-outline" size={16} color={colors.foreground} />
          <Text style={[text.subheading, { color: colors.foreground, flex: 1 }]}>
            {narrowed === 0 ? 'Filter' : `${narrowed} filter${narrowed === 1 ? '' : 's'} on`}
          </Text>
          {narrowed > 0 ? (
            <Pressable onPress={() => setFilters(NO_FILTERS)} hitSlop={10}>
              <Ionicons name="close-circle" size={17} color={colors.mutedForeground} />
            </Pressable>
          ) : (
            <Ionicons name="chevron-down" size={15} color={colors.mutedForeground} />
          )}
        </Pressable>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((cat) => {
            const active = filter === cat;
            return (
              <Pressable
                key={cat}
                onPress={() => setFilter(cat)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? colors.foreground : 'transparent',
                    borderColor: active ? colors.foreground : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    text.subheading,
                    {
                      fontSize: 13,
                      color: active ? colors.background : colors.mutedForeground,
                      fontFamily: active ? font.sansBold : font.sans,
                    },
                  ]}
                >
                  {cat}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── Jobs ─────────────────────────────────────────────────── */}
        {available.length > 0 ? (
          available.map((task) => (
            <TaskCard key={task.id} task={task} onPress={() => router.push(`/task/${task.id}`)} />
          ))
        ) : (
          <View style={styles.empty}>
            <Text style={[text.title, { color: colors.foreground, textAlign: 'center' }]}>
              Nothing here yet.
            </Text>
            <Text
              style={[
                text.body,
                { color: colors.mutedForeground, textAlign: 'center', maxWidth: 260 },
              ]}
            >
              {filter === 'Near me'
                ? `Nothing open in ${nearLabel} right now. Try All to see other cities.`
                : 'No open jobs match this filter right now.'}
            </Text>
            <Pressable
              onPress={() => {
                setFilter('All');
                setFilters(NO_FILTERS);
                setLocationFilter(null);
              }}
              style={[styles.clearBtn, { borderColor: colors.borderStrong }]}
            >
              <Text style={[text.action, { color: colors.foreground }]}>Clear filters</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* ── Area sheet ─────────────────────────────────────────────── */}

      <JobFilterSheet
        visible={filterOpen}
        value={filters}
        onClose={() => setFilterOpen(false)}
        onApply={setFilters}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 36 },

  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20 },

  queryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderRadius: 2,
    padding: 14,
    marginBottom: 16,
  },
  mineHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 12,
    marginTop: 2,
    marginBottom: 18,
  },

  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 13,
    paddingVertical: 12,
    marginTop: 18,
  },
  // The chips sit against the first job card, and 18 was not enough to read as
  // a break between "how you are filtering" and "what you filtered to".
  // Held off the Filter button above as well as the jobs below: the two are
  // separate controls and were reading as one block stuck together.
  filterRow: { gap: 8, paddingRight: 20, marginTop: 14, marginBottom: 30 },
  filterChip: { borderWidth: 2, borderRadius: 2, paddingHorizontal: 15, paddingVertical: 8 },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 56 },
  clearBtn: {
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 22,
    paddingVertical: 12,
    marginTop: 6,
  },

});
