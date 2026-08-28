import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import { COUNTRIES, STATE_NAMES, lgasIn } from '@/constants/nigeria';

/**
 * Country, then state, then area.
 *
 * Three steps rather than one list, for two different reasons.
 *
 * 774 local government areas is not something to scroll. And the names are not
 * unique — there is an Ifelodun in Kwara and another in Osun, an Obi in Benue
 * and another in Nasarawa — so narrowing first is what makes the answer
 * unambiguous rather than merely shorter.
 *
 * The country step has one option today. It stays because the question will
 * have more than one answer eventually, and a step added later moves a screen
 * people have already learned.
 */
export type AreaChoice = { country: string; state: string; lga: string };

type Level = 'country' | 'state' | 'lga';

export function AreaPicker({
  value,
  onChange,
}: {
  value: AreaChoice | null;
  onChange: (choice: AreaChoice) => void;
}) {
  const colors = useColors();

  const [country, setCountry] = useState<string | null>(value?.country ?? null);
  const [state, setState] = useState<string | null>(value?.state ?? null);
  const [search, setSearch] = useState('');

  const level: Level = country === null ? 'country' : state === null ? 'state' : 'lga';

  const options = useMemo(() => {
    if (level === 'country') return COUNTRIES.map((c) => c.name);
    if (level === 'state') return STATE_NAMES;
    return lgasIn(state!);
  }, [level, state]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return options;
    return options.filter((name) => name.toLowerCase().includes(needle));
  }, [options, search]);

  /** Steps back one level, so a wrong turn is one tap to correct. */
  function back() {
    if (level === 'lga') setState(null);
    else if (level === 'state') setCountry(null);
    setSearch('');
  }

  function pick(name: string) {
    setSearch('');
    if (level === 'country') {
      setCountry(name);
      return;
    }
    if (level === 'state') {
      setState(name);
      return;
    }
    onChange({ country: country!, state: state!, lga: name });
  }

  const placeholder =
    level === 'country'
      ? 'Search countries'
      : level === 'state'
        ? 'Search states'
        : `Search ${state} areas`;


  return (
    <View style={styles.wrap}>
      {/* Where you are, and the way back. */}
      {level !== 'country' && (
        <Pressable
          onPress={back}
          style={({ pressed }) => [
            styles.crumb,
            { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="chevron-back" size={14} color={colors.accent} />
          <Text style={[text.data, { color: colors.accent }]}>
            {level === 'lga' ? state : country}
          </Text>
          <Text style={[text.data, { color: colors.faintForeground, flex: 1 }]}>
            · {level === 'lga' ? 'pick your area' : 'pick your state'}
          </Text>
        </Pressable>
      )}

      {/* One country makes a search box pure clutter. */}
      {options.length > 8 && (
        <View
          style={[
            styles.searchRow,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Ionicons name="search" size={15} color={colors.faintForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={placeholder}
            placeholderTextColor={colors.faintForeground}
            autoCapitalize="words"
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.faintForeground} />
            </Pressable>
          )}
        </View>
      )}

      <ScrollView
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        // This list is capped at 300 and sits inside WelcomeSheet's own
        // scroll view. On Android the outer view keeps the gesture unless the
        // inner one claims it, and the area list would not scroll at all.
        nestedScrollEnabled
      >
        {filtered.map((name) => {
          const picked = level === 'lga' && value?.lga === name && value.state === state;
          const entry = level === 'country' ? COUNTRIES.find((c) => c.name === name) : null;
          const unavailable = entry ? !entry.available : false;

          return (
            <Pressable
              key={name}
              onPress={() => !unavailable && pick(name)}
              disabled={unavailable}
              style={({ pressed }) => [
                styles.row,
                {
                  borderBottomColor: colors.border,
                  backgroundColor: pressed && !unavailable ? colors.sunken : 'transparent',
                  opacity: unavailable ? 0.45 : 1,
                },
              ]}
            >
              {entry && <Text style={styles.flag}>{entry.flag}</Text>}

              <View style={{ flex: 1 }}>
                <Text style={[text.body, { color: picked ? colors.primary : colors.foreground }]}>
                  {name}
                </Text>
                {/* Says why it cannot be chosen, rather than just refusing. */}
                {unavailable && (
                  <Text style={[text.data, { color: colors.faintForeground }]}>
                    Not open here yet
                  </Text>
                )}
              </View>

              {picked ? (
                <Ionicons name="checkmark" size={16} color={colors.primary} />
              ) : unavailable ? null : (
                <Ionicons
                  name={level === 'lga' ? 'ellipse-outline' : 'chevron-forward'}
                  size={level === 'lga' ? 13 : 15}
                  color={colors.faintForeground}
                />
              )}
            </Pressable>
          );
        })}

        {filtered.length === 0 && (
          <Text style={[text.bodySmall, styles.empty, { color: colors.mutedForeground }]}>
            Nothing matches “{search.trim()}”.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  crumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontFamily: font.sans, fontSize: 16 },
  // Bounded so the sheet does not grow past the screen on a long state.
  list: { maxHeight: 300 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
  },
  flag: { fontSize: 22 },
  empty: { paddingVertical: 24, textAlign: 'center' },
});
