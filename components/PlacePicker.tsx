import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import type { Place } from '@/contexts/AppContext';
import {
  hasLivePlaces,
  newSessionToken,
  placesProvider,
  providerLabel,
  resolvePlace,
  reverseLookup,
  searchKnownPlaces,
  searchPlaces,
} from '@/utils/places';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (place: Place) => void;
};

/**
 * Picks the place a question is about.
 *
 * A verifier has to be told where to walk to, so the place is structured data
 * rather than something inferred from the wording of the question. Three ways
 * in, in the order people actually need them: where they are standing, a
 * place we know, or a name they type themselves.
 */
export function PlacePicker({ visible, onClose, onSelect }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [results, setResults] = useState<Place[]>(() => searchKnownPlaces(''));
  const [searching, setSearching] = useState(false);
  const [live, setLive] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // One token per open-to-select cycle, so Google bills the keystrokes as a
  // single autocomplete session rather than as individual requests.
  const session = useRef(newSessionToken());
  const trimmed = query.trim();

  useEffect(() => {
    if (visible) session.current = newSessionToken();
  }, [visible]);

  // Debounced so a lookup is not fired on every keystroke, and aborted when
  // the next letter arrives so stale results can never overwrite fresh ones.
  useEffect(() => {
    if (!visible) return;

    const controller = new AbortController();
    let cancelled = false;

    if (hasLivePlaces && trimmed.length >= 2) setSearching(true);

    const timer = setTimeout(
      async () => {
        const outcome = await searchPlaces(trimmed, {
          signal: controller.signal,
          sessionToken: session.current,
        });
        if (cancelled || controller.signal.aborted) return;
        setResults(outcome.places);
        setLive(outcome.live);
        setSearchError(outcome.error ?? null);
        setSearching(false);
      },
      hasLivePlaces ? 250 : 0,
    );

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmed, visible]);

  // Offer the typed text as a place when nothing on file matches it exactly.
  // No catalogue covers every kiosk, and a named place we cannot resolve is
  // still far better for the verifier than a question with no place at all.
  const showFreeform =
    trimmed.length > 2 &&
    !results.some((p) => p.name.toLowerCase() === trimmed.toLowerCase());

  async function choose(place: Place) {
    setQuery('');
    setLocationError(null);
    setSearchError(null);
    // Coordinates are looked up only for the one place actually picked.
    onSelect(await resolvePlace(place, session.current));
  }

  async function useCurrentLocation() {
    setLocating(true);
    setLocationError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission was declined.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      // Coordinates are the floor, not a placeholder: a verifier can navigate
      // to them, whereas the words "my current location" tell them nothing.
      const pin = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
      let name = pin;
      let area = 'Dropped pin';

      // The device geocoder first — free and offline on native. It is
      // unsupported on web, which is why the network lookup backs it up.
      try {
        const [geo] = await Location.reverseGeocodeAsync({
          latitude: coords.lat,
          longitude: coords.lng,
        });
        const deviceName = geo?.name ?? geo?.street;
        if (deviceName) {
          name = deviceName;
          area = [geo?.district, geo?.city, geo?.region].filter(Boolean).join(', ') || pin;
        }
      } catch {
        // Expected on web; handled by the lookup below.
      }

      if (name === pin) {
        const resolved = await reverseLookup(coords);
        if (resolved) {
          name = resolved.name;
          area = resolved.area || pin;
        }
      }

      choose({ id: `loc-${Date.now()}`, name, area, coords });
    } catch {
      setLocationError('Could not get your location. Search for the place instead.');
    } finally {
      setLocating(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: colors.borderStrong,
              paddingBottom: (Platform.OS === 'web' ? 20 : insets.bottom) + 20,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />

          <Text style={[text.title, { color: colors.foreground }]}>Where should we check?</Text>
          <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 4 }]}>
            Someone has to walk to this spot, so be as exact as you can.
          </Text>

          <View
            style={[
              styles.search,
              { backgroundColor: colors.surface, borderColor: colors.borderStrong },
            ]}
          >
            <Ionicons name="search" size={16} color={colors.faintForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Station, market, shop, street…"
              placeholderTextColor={colors.faintForeground}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              returnKeyType="search"
            />
            {searching ? (
              <ActivityIndicator size="small" color={colors.faintForeground} />
            ) : trimmed.length > 0 ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.faintForeground} />
              </Pressable>
            ) : null}
          </View>

          {/* Say where the results come from — a saved list and a live search
              behave differently and the user should not have to guess. */}
          <View style={styles.sourceRow}>
            <View
              style={[
                styles.sourceDot,
                { backgroundColor: live ? colors.primary : colors.faintForeground },
              ]}
            />
            <Text style={[text.data, { color: colors.faintForeground, flex: 1 }]}>
              {searchError
                ? searchError
                : live
                  ? `Searching ${providerLabel[placesProvider]}`
                  : hasLivePlaces
                    ? 'Saved places'
                    : 'Saved places · set a provider for live search'}
            </Text>
          </View>

          <Pressable
            onPress={useCurrentLocation}
            disabled={locating}
            style={({ pressed }) => [
              styles.currentBtn,
              { borderColor: colors.accent, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            {locating ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Ionicons name="navigate" size={16} color={colors.accent} />
            )}
            <Text style={[text.action, { color: colors.accent }]}>
              {locating ? 'Finding you' : 'Use my current location'}
            </Text>
          </Pressable>

          {locationError && (
            <Text style={[text.bodySmall, { color: colors.danger, marginTop: 8 }]}>
              {locationError}
            </Text>
          )}

          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {showFreeform && (
              <Pressable
                onPress={() =>
                  choose({
                    id: `free-${Date.now()}`,
                    name: trimmed,
                    area: 'Typed by you',
                    freeform: true,
                  })
                }
                style={({ pressed }) => [
                  styles.row,
                  { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons name="add-circle-outline" size={17} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[text.subheading, { color: colors.foreground }]}>
                    Use “{trimmed}”
                  </Text>
                  <Text style={[text.data, { color: colors.faintForeground }]}>
                    Not on our list
                  </Text>
                </View>
              </Pressable>
            )}

            {results.map((place) => (
              <Pressable
                key={place.id}
                onPress={() => choose(place)}
                style={({ pressed }) => [
                  styles.row,
                  { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons name="location-outline" size={17} color={colors.mutedForeground} />
                <View style={{ flex: 1 }}>
                  <Text style={[text.subheading, { color: colors.foreground }]}>{place.name}</Text>
                  <Text style={[text.data, { color: colors.faintForeground }]}>{place.area}</Text>
                </View>
              </Pressable>
            ))}

            {results.length === 0 && !showFreeform && !searching && (
              <Text style={[text.bodySmall, { color: colors.faintForeground, paddingVertical: 20 }]}>
                Nothing matches that yet. Keep typing to use it as written.
              </Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '88%',
  },
  grabber: { width: 38, height: 3, alignSelf: 'center', marginBottom: 16 },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 13,
    paddingVertical: 12,
    marginTop: 16,
  },
  searchInput: { flex: 1, fontFamily: font.sans, fontSize: 15 },

  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9 },
  sourceDot: { width: 6, height: 6, borderRadius: 1 },

  currentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 13,
    marginTop: 10,
  },

  list: { marginTop: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
});
