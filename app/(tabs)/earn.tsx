import React, { useRef, useState } from 'react';
import {
  Animated,
  Modal,
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
import { AREAS, useApp } from '@/contexts/AppContext';
import { FEE_PERCENT } from '@/constants/money';
import { TaskCard } from '@/components/TaskCard';
import { JobRow } from '@/components/JobRow';

/**
 * One flat, mutually exclusive list rather than two stacked controls.
 * "Near me" leads because a job you cannot reach is not a job — the rest of
 * the country is one tap away under "All".
 */
const FILTERS = ['Near me', 'All', 'Fuel', 'Food', 'Traffic', 'Shopping', 'Safety'] as const;
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
  } = useApp();

  const openQueries = disputes.filter((d) => d.status === 'awaiting_verifier').length;
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  const [filter, setFilter] = useState<Filter>('Near me');
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetAnim = useRef(new Animated.Value(400)).current;

  function openSheet() {
    setSheetOpen(true);
    Animated.spring(sheetAnim, {
      toValue: 0,
      tension: 62,
      friction: 12,
      useNativeDriver: true,
    }).start();
  }

  function closeSheet() {
    Animated.timing(sheetAnim, { toValue: 400, duration: 220, useNativeDriver: true }).start(() =>
      setSheetOpen(false),
    );
  }

  // Where "near me" means: the area you picked to work in, falling back to
  // the home area on your profile.
  const nearLabel = locationFilter?.label ?? homeArea.label;

  const available = nearbyTasks.filter((t) => {
    if (t.status !== 'available') return false;

    const area = t.area?.toLowerCase() ?? '';
    const near = nearLabel.toLowerCase();
    const isNear = area.includes(near) || near.includes(area);

    if (filter === 'Near me') return isNear;
    if (filter === 'All') return true;
    return t.category.toLowerCase() === filter.toLowerCase();
  });

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
              Go and look. Paid on-chain when the asker confirms.
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
                View all {activeJobs.length}
              </Text>
              <Ionicons name="arrow-forward" size={14} color={colors.foreground} />
            </Pressable>
          </>
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

        {/* ── Where ────────────────────────────────────────────────── */}
        <Pressable
          onPress={openSheet}
          style={({ pressed }) => [
            styles.areaBtn,
            {
              borderColor: locationFilter ? colors.foreground : colors.border,
              backgroundColor: pressed ? colors.sunken : 'transparent',
            },
          ]}
        >
          <Ionicons name="location-outline" size={15} color={colors.foreground} />
          <Text style={[text.subheading, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>
            {nearLabel}
          </Text>
          {locationFilter ? (
            <Pressable onPress={() => setLocationFilter(null)} hitSlop={10}>
              <Ionicons name="close-circle" size={17} color={colors.mutedForeground} />
            </Pressable>
          ) : (
            <Ionicons name="chevron-down" size={15} color={colors.mutedForeground} />
          )}
        </Pressable>

        {/* ── At a glance ──────────────────────────────────────────── */}
        <View style={[styles.glance, { borderColor: colors.border }]}>
          {[
            { label: 'Open', value: String(available.length) },
            { label: 'Typical pay', value: '₦630' },
            { label: 'Typical time', value: '6 min' },
          ].map((s, i) => (
            <View
              key={s.label}
              style={[
                styles.glanceCell,
                i > 0 && { borderLeftWidth: 1, borderLeftColor: colors.border },
              ]}
            >
              <Text style={[text.amount, { color: colors.foreground, fontSize: 17 }]}>
                {s.value}
              </Text>
              <Text style={[text.data, { color: colors.faintForeground }]}>{s.label}</Text>
            </View>
          ))}
        </View>

        <Text style={[text.data, styles.feeNote, { color: colors.faintForeground }]}>
          Amounts shown are what you keep, after the {FEE_PERCENT} platform fee. Paid in USDC on Base.
        </Text>

        {/* ── Filters ──────────────────────────────────────────────── */}
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
      <Modal visible={sheetOpen} transparent animationType="fade" onRequestClose={closeSheet}>
        <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={closeSheet}>
          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                transform: [{ translateY: sheetAnim }],
                paddingBottom: (Platform.OS === 'web' ? 24 : insets.bottom) + 24,
              },
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />
            <Text style={[text.title, { color: colors.foreground }]}>Where can you go?</Text>
            <Text style={[text.body, { color: colors.mutedForeground, marginBottom: 8 }]}>
              You will only see jobs — and get alerts — for the area you pick.
            </Text>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.areaList}>
              {AREAS.map((area) => {
                const selected = locationFilter?.label === area.label;
                return (
                  <Pressable
                    key={area.key}
                    onPress={() => {
                      setLocationFilter({ key: area.key, label: area.label });
                      closeSheet();
                    }}
                    style={({ pressed }) => [
                      styles.areaRow,
                      {
                        borderBottomColor: colors.border,
                        backgroundColor: pressed ? colors.sunken : 'transparent',
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          text.subheading,
                          {
                            color: colors.foreground,
                            fontFamily: selected ? font.sansBold : font.sansMedium,
                          },
                        ]}
                      >
                        {area.label}
                      </Text>
                      <Text style={[text.data, { color: colors.faintForeground }]}>
                        {area.state}
                      </Text>
                    </View>
                    {selected && (
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </Pressable>
      </Modal>
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

  areaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 14,
  },

  glance: { flexDirection: 'row', borderWidth: 2, borderRadius: 2, overflow: 'hidden' },
  glanceCell: { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 3 },

  feeNote: { marginTop: 12, marginBottom: 20, lineHeight: 17 },

  filterRow: { gap: 8, paddingRight: 20, marginBottom: 18 },
  filterChip: { borderWidth: 2, borderRadius: 2, paddingHorizontal: 15, paddingVertical: 8 },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 56 },
  clearBtn: {
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 22,
    paddingVertical: 12,
    marginTop: 6,
  },

  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 2,
    paddingHorizontal: 22,
    paddingTop: 12,
    gap: 6,
    maxHeight: '82%',
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 18,
  },
  areaList: { marginTop: 6 },
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    borderBottomWidth: 1,
  },
});
