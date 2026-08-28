import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';
import { formatNaira, verifierCut } from '@/constants/money';
import { STATE_NAMES, lgasIn } from '@/constants/nigeria';
import { SheetKeyboardView } from '@/components/SheetKeyboardView';

export type JobFilters = {
  state: string | null;
  city: string | null;
  /** Naira, and what the verifier keeps rather than the posted bounty. */
  minPay: number | null;
  /** Deadline in minutes, at most. */
  maxMinutes: number | null;
  /**
   * Order, not a filter — it hides nothing, so it stays out of the count that
   * the Filter button shows. Null keeps whatever order the board arrived in.
   */
  sort: 'low' | 'high' | null;
};

export const NO_FILTERS: JobFilters = {
  state: null,
  city: null,
  minPay: null,
  maxMinutes: null,
  sort: null,
};

export function activeFilterCount(f: JobFilters): number {
  // Deliberately without `sort`: reordering a list is not filtering it, and
  // "3 filters on" would be a lie about how much is being hidden.
  return [f.state, f.city, f.minPay, f.maxMinutes].filter((v) => v !== null).length;
}

/**
 * Whether a job survives the filters.
 *
 * Place matching reads name, area and state together for the same reason
 * isJobNearArea does: which field holds the locality depends entirely on where
 * the place came from, and the Surulere job is stored as area "Lagos" with the
 * name "Surulere".
 */
export function matchesFilters(
  job: { location?: string; area?: string; state?: string; reward: number; estimatedTime: string },
  f: JobFilters,
): boolean {
  const where = `${job.location ?? ''} ${job.area ?? ''} ${job.state ?? ''}`.toLowerCase();

  if (f.state && !where.includes(f.state.toLowerCase())) return false;
  if (f.city && !where.includes(f.city.toLowerCase())) return false;
  if (f.minPay !== null && verifierCut(job.reward) < f.minPay) return false;

  if (f.maxMinutes !== null) {
    // estimatedTime is written as "60m" by the job mapper.
    const minutes = Number.parseInt(job.estimatedTime, 10);
    if (Number.isFinite(minutes) && minutes > f.maxMinutes) return false;
  }

  return true;
}

/**
 * Orders a filtered list by what the verifier keeps.
 *
 * Sorts on verifierCut rather than the posted bounty so it agrees with the pay
 * filter above it — two controls sitting together that disagreed about what
 * "pay" means would be worse than either.
 */
export function sortJobs<T extends { reward: number }>(jobs: T[], sort: JobFilters['sort']): T[] {
  if (!sort) return jobs;
  // Copied first: sort mutates, and the array handed in belongs to app state.
  return [...jobs].sort((a, b) =>
    sort === 'low' ? verifierCut(a.reward) - verifierCut(b.reward) : verifierCut(b.reward) - verifierCut(a.reward),
  );
}

const PAY_STEPS = [1_000, 2_000, 5_000, 10_000];
const TIME_STEPS = [15, 30, 60, 120, 360, 1_440];

/* ── A list you pick one thing from ───────────────────────────────────────── */

/**
 * A dropdown, rather than every option laid out at once.
 *
 * There are 37 states and up to 20-odd LGAs in each. As chips that was several
 * screens of scrolling before reaching the pay and time sections, which are
 * the ones most people actually want. A closed control that says what is
 * chosen keeps the whole sheet readable at a glance.
 */
function PickerField({
  label,
  placeholder,
  value,
  options,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string | null;
  options: string[];
  onChange: (next: string | null) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, search]);

  return (
    <>
      <Text style={[text.label, styles.sectionLabel, { color: colors.faintForeground }]}>
        {label}
      </Text>

      <Pressable
        onPress={() => {
          setSearch('');
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.field,
          {
            borderColor: value ? colors.foreground : colors.border,
            backgroundColor: pressed ? colors.sunken : 'transparent',
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            text.subheading,
            { color: value ? colors.foreground : colors.faintForeground, flex: 1 },
          ]}
        >
          {value ?? placeholder}
        </Text>
        {value ? (
          <Pressable onPress={() => onChange(null)} hitSlop={10}>
            <Ionicons name="close-circle" size={17} color={colors.mutedForeground} />
          </Pressable>
        ) : (
          <Ionicons name="chevron-down" size={15} color={colors.mutedForeground} />
        )}
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
        navigationBarTranslucent
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={() => setOpen(false)}
        >
          <SheetKeyboardView style={styles.lift}>
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.borderStrong,
                  paddingBottom: insets.bottom + 14,
                },
              ]}
            >
              <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />

              <Text style={[text.title, { color: colors.foreground }]}>{label}</Text>

              {/* Worth having at 37 states, and indispensable inside a state
                  with two dozen LGAs. */}
              <View style={[styles.search, { borderColor: colors.border }]}>
                <Ionicons name="search" size={15} color={colors.faintForeground} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search"
                  placeholderTextColor={colors.faintForeground}
                  autoCorrect={false}
                  style={[text.subheading, { color: colors.foreground, flex: 1, padding: 0 }]}
                />
              </View>

              <ScrollView
                style={styles.list}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {shown.map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => {
                      onChange(option);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      {
                        borderBottomColor: colors.border,
                        backgroundColor: pressed ? colors.sunken : 'transparent',
                      },
                    ]}
                  >
                    <Text style={[text.subheading, { color: colors.foreground, flex: 1 }]}>
                      {option}
                    </Text>
                    {value === option && (
                      <Ionicons name="checkmark" size={16} color={colors.primary} />
                    )}
                  </Pressable>
                ))}

                {shown.length === 0 && (
                  <Text
                    style={[
                      text.bodySmall,
                      { color: colors.faintForeground, paddingVertical: 20 },
                    ]}
                  >
                    Nothing matches that.
                  </Text>
                )}
              </ScrollView>
            </Pressable>
          </SheetKeyboardView>
        </Pressable>
      </Modal>
    </>
  );
}

/* ── The sheet ────────────────────────────────────────────────────────────── */

type Props = {
  visible: boolean;
  value: JobFilters;
  onClose: () => void;
  onApply: (next: JobFilters) => void;
};

export function JobFilterSheet({ visible, value, onClose, onApply }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  /**
   * Edited locally and only handed back on Apply.
   *
   * Filtering live would rearrange the list behind a panel covering it, and
   * leave no way to back out of a change except undoing every tap by hand.
   */
  const [draft, setDraft] = useState<JobFilters>(value);
  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  const cities = draft.state ? lgasIn(draft.state) : [];
  const count = activeFilterCount(draft);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
        <SheetKeyboardView style={styles.lift}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.sheet,
              {
                backgroundColor: colors.background,
                borderColor: colors.borderStrong,
                paddingBottom: insets.bottom + 18,
              },
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />

            <View style={styles.head}>
              <Text style={[text.title, { color: colors.foreground, flex: 1 }]}>Filter jobs</Text>
              {count > 0 && (
                <Pressable onPress={() => setDraft(NO_FILTERS)} hitSlop={10}>
                  <Text style={[text.action, { color: colors.accent }]}>Clear</Text>
                </Pressable>
              )}
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <PickerField
                label="State"
                placeholder="Anywhere"
                value={draft.state}
                options={STATE_NAMES}
                onChange={(next) =>
                  /**
                   * Changing state clears the city with it: an LGA belongs to
                   * exactly one state, so keeping the old one would filter to
                   * nothing and read as a broken list.
                   */
                  setDraft((d) => ({ ...d, state: next, city: null }))
                }
              />

              {draft.state && (
                <PickerField
                  label={`City or LGA in ${draft.state}`}
                  placeholder="Anywhere in the state"
                  value={draft.city}
                  options={cities}
                  onChange={(next) => setDraft((d) => ({ ...d, city: next }))}
                />
              )}

              <Text style={[text.label, styles.sectionLabel, { color: colors.faintForeground }]}>
                Order by pay
              </Text>
              <View style={styles.chipWrap}>
                {([
                  { key: 'high', label: 'Highest first' },
                  { key: 'low', label: 'Lowest first' },
                ] as const).map((option) => {
                  const on = draft.sort === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => setDraft((d) => ({ ...d, sort: on ? null : option.key }))}
                      style={({ pressed }) => [
                        styles.chip,
                        {
                          backgroundColor: on ? colors.foreground : 'transparent',
                          borderColor: on ? colors.foreground : colors.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          text.data,
                          { color: on ? colors.background : colors.mutedForeground },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[text.label, styles.sectionLabel, { color: colors.faintForeground }]}>
                Pays at least
              </Text>
              <View style={styles.chipWrap}>
                {PAY_STEPS.map((amount) => {
                  const on = draft.minPay === amount;
                  return (
                    <Pressable
                      key={amount}
                      onPress={() => setDraft((d) => ({ ...d, minPay: on ? null : amount }))}
                      style={({ pressed }) => [
                        styles.chip,
                        {
                          backgroundColor: on ? colors.foreground : 'transparent',
                          borderColor: on ? colors.foreground : colors.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          text.data,
                          { color: on ? colors.background : colors.mutedForeground },
                        ]}
                      >
                        ₦{formatNaira(amount)}+
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[text.label, styles.sectionLabel, { color: colors.faintForeground }]}>
                Done within
              </Text>
              <View style={styles.chipWrap}>
                {TIME_STEPS.map((minutes) => {
                  const on = draft.maxMinutes === minutes;
                  return (
                    <Pressable
                      key={minutes}
                      onPress={() =>
                        setDraft((d) => ({ ...d, maxMinutes: on ? null : minutes }))
                      }
                      style={({ pressed }) => [
                        styles.chip,
                        {
                          backgroundColor: on ? colors.foreground : 'transparent',
                          borderColor: on ? colors.foreground : colors.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          text.data,
                          { color: on ? colors.background : colors.mutedForeground },
                        ]}
                      >
                        {minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <Pressable
              onPress={() => {
                onApply(draft);
                onClose();
              }}
              style={({ pressed }) => [
                styles.apply,
                { backgroundColor: colors.foreground, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[text.action, { color: colors.background }]}>
                {count === 0 ? 'Show everything' : `Apply ${count} filter${count === 1 ? '' : 's'}`}
              </Text>
            </Pressable>
          </Pressable>
        </SheetKeyboardView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  lift: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 20,
    paddingTop: 12,
    // Capped so a long list cannot push the button at the bottom off screen.
    maxHeight: '88%',
  },
  grabber: { width: 38, height: 3, alignSelf: 'center', marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  body: { flexShrink: 1, marginTop: 4 },
  bodyContent: { paddingBottom: 12 },
  sectionLabel: { marginTop: 20, marginBottom: 8 },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 13,
    paddingVertical: 13,
  },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginTop: 14,
  },
  list: { marginTop: 8, maxHeight: 320 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    paddingVertical: 14,
  },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 2, borderRadius: 2, paddingHorizontal: 13, paddingVertical: 8 },
  apply: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 2,
    paddingVertical: 15,
    marginTop: 16,
  },
});
