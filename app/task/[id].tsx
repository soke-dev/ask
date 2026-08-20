import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
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
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import { useApp } from '@/contexts/AppContext';
import { FEE_PERCENT, PLATFORM_FEE } from '@/constants/money';
import { hasApi } from '@/utils/api';
import {
  MAX_ATTEMPTS,
  runEvidenceGate,
  type EvidenceCheck,
  type EvidenceReport,
} from '@/utils/evidenceChecks';

type PageState =
  | 'detail'
  | 'locating'
  | 'countdown'
  | 'form'
  | 'ai_checking'
  | 'check_result'
  | 'pending_asker'
  | 'earned';
type MediaChoice = 'photo' | 'video' | null;

/** One captured file. `seconds` is set for video only. */
type Shot = { uri: string; seconds?: number };

/** Enough angles to prove a scene without turning review into a slideshow. */
const MAX_PHOTOS = 5;
/** Matches videoMaxDuration, and re-checked because that only caps recording. */
const MAX_VIDEO_SECONDS = 30;

type CaptureTip = {
  icon: keyof typeof Ionicons.glyphMap;
  lead: string;
  body: string;
  /** The one rule that matters most; highlighted. */
  key?: boolean;
};

const CAPTURE_TIPS: Record<'photo' | 'video', CaptureTip[]> = {
  video: [
    {
      icon: 'mic-outline',
      lead: 'Say today’s date and time first.',
      body: 'Out loud, before anything else. It proves the clip is from today.',
      key: true,
    },
    {
      icon: 'walk-outline',
      lead: 'Pan slowly across what you are showing.',
      body: 'Steady, left to right. Do not rush it.',
    },
    {
      icon: 'chatbox-ellipses-outline',
      lead: 'Say what you are seeing.',
      body: 'Prices, how many people, whether it is open.',
    },
    {
      icon: 'timer-outline',
      lead: 'Keep it under 30 seconds.',
      body: 'The camera stops there. Long clips are slow to upload and slow to review.',
    },
  ],
  photo: [
    {
      icon: 'scan-outline',
      lead: 'Get the whole thing in frame.',
      body: 'The queue, the sign, the price board — not just a corner.',
    },
    {
      icon: 'eye-outline',
      lead: 'Hold still until it is sharp.',
      body: 'A blurred photo gets queried and you do not get paid.',
    },
    {
      icon: 'sunny-outline',
      lead: 'Watch the light.',
      body: 'Avoid shooting into the sun or through glare.',
    },
    {
      icon: 'business-outline',
      lead: 'Include something that names the place.',
      body: 'A signboard or shopfront proves where you were.',
    },
  ],
};

function clock(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function tap(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium) {
  if (Platform.OS !== 'web') Haptics.impactAsync(style);
}

function Breath({ children }: { children: React.ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.06, duration: 750, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 750, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [scale]);
  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
}

/**
 * One line of the gate's report.
 *
 * A skipped check is drawn differently from a passed one on purpose. "We did
 * not look at this" and "we looked and it was fine" are different facts, and
 * collapsing them into a single tick is how a verifier ends up believing their
 * evidence was vetted when nothing examined it.
 */
function CheckRow({
  check,
  colors,
}: {
  check: EvidenceCheck;
  colors: ReturnType<typeof useColors>;
}) {
  const look = {
    pass: { icon: 'checkmark-circle' as const, tint: colors.primary },
    warn: { icon: 'alert-circle' as const, tint: colors.pending },
    fail: { icon: 'close-circle' as const, tint: colors.danger },
    skipped: { icon: 'remove-circle-outline' as const, tint: colors.faintForeground },
  }[check.verdict];

  return (
    <View style={[styles.checkRow, { borderBottomColor: colors.border }]}>
      <Ionicons name={look.icon} size={17} color={look.tint} />
      <Text style={[text.bodySmall, { color: colors.foreground, flex: 1 }]}>{check.detail}</Text>
    </View>
  );
}

export default function TaskScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { nearbyTasks, acceptTask, completeTask, identity, queries } = useApp();
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  const task = nearbyTasks.find((t) => t.id === id);

  const [pageState, setPageState] = useState<PageState>(
    task?.status === 'accepted' ? 'form' : 'detail',
  );
  const [expiry, setExpiry] = useState(task?.expiresIn ?? 600);
  const [startIn, setStartIn] = useState(30);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [media, setMedia] = useState<MediaChoice>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [watchers, setWatchers] = useState(task?.viewersCount ?? 3);
  const [place, setPlace] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [report, setReport] = useState<EvidenceReport | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (pageState !== 'detail' && pageState !== 'form') return;
    const t = setInterval(() => setExpiry((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [pageState]);

  useEffect(() => {
    if (pageState !== 'detail') return;
    const t = setInterval(
      () => setWatchers((v) => Math.max(1, v + (Math.random() > 0.5 ? -1 : 1))),
      2500,
    );
    return () => clearInterval(t);
  }, [pageState]);

  useEffect(() => {
    if (pageState !== 'countdown') return;
    if (startIn <= 0) {
      setPageState('form');
      return;
    }
    const t = setInterval(() => setStartIn((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [pageState, startIn]);

  if (!task) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[text.title, { color: colors.foreground }]}>This job is gone.</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={[text.action, { color: colors.accent }]}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const locked = Boolean(task.verifiedOnly) && identity.status !== 'verified';

  /**
   * Where the question actually pointed, when there is one.
   *
   * Jobs raised from the Ask tab carry the asker's chosen place, and that
   * place may carry coordinates. Seeded demo jobs carry neither, so the
   * distance check reports itself as skipped rather than inventing a target.
   */
  const linkedQuery = task.fromQueryId ? queries.find((q) => q.id === task.fromQueryId) : undefined;
  const targetCoords = linkedQuery?.place?.coords ?? null;
  const askedQuestion = linkedQuery?.question ?? task.title;
  const yourCut = Math.round(task.reward * (1 - PLATFORM_FEE));
  const fee = task.reward - yourCut;
  const categoryTint = {
    fuel: colors.catFuel,
    food: colors.catFood,
    traffic: colors.catTraffic,
    shopping: colors.catShopping,
    safety: colors.catSafety,
  }[task.category];

  /**
   * Shrinks a photo before it goes anywhere.
   *
   * A modern phone camera produces 4–8 MB frames, which is punishing on
   * Nigerian mobile data and slow for the asker to load. 1600px on the long
   * edge is still far more detail than a queue or a price board needs.
   */
  async function compress(uri: string): Promise<string> {
    try {
      const result = await manipulateAsync(uri, [{ resize: { width: 1600 } }], {
        compress: 0.6,
        format: SaveFormat.JPEG,
      });
      return result.uri;
    } catch {
      // Better to send the original than to lose the evidence entirely.
      return uri;
    }
  }

  /**
   * Camera only, never the gallery: evidence has to be taken now, at the
   * place, and a library picker would accept anything saved from anywhere.
   */
  async function capture() {
    setTipsOpen(false);
    setCameraError(null);

    if (media === 'photo' && shots.length >= MAX_PHOTOS) {
      setCameraError(`That is the limit of ${MAX_PHOTOS} photos.`);
      return;
    }

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setCameraError('Camera access was declined. Allow it to send evidence.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: media === 'video' ? ['videos'] : ['images'],
        quality: 0.7,
        videoMaxDuration: MAX_VIDEO_SECONDS,
      });

      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];

      if (media === 'video') {
        const seconds = asset.duration ? Math.round(asset.duration / 1000) : 0;
        // videoMaxDuration caps the recorder, but not every platform honours
        // it, so the result is checked rather than trusted.
        if (seconds > MAX_VIDEO_SECONDS) {
          setCameraError(
            `That clip is ${seconds}s. Keep it under ${MAX_VIDEO_SECONDS}s and record again.`,
          );
          return;
        }
        setShots([{ uri: asset.uri, seconds }]);
        tap(Haptics.ImpactFeedbackStyle.Light);
        return;
      }

      setBusy(true);
      const uri = await compress(asset.uri);
      setShots((prev) => [...prev, { uri }].slice(0, MAX_PHOTOS));
      tap(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setCameraError('The camera could not be opened on this device.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Puts the evidence through the gate before the asker ever sees it.
   *
   * What runs depends on what is reachable. Length, photo count and distance
   * from the place are measured on the phone. Blur, lighting and whether the
   * picture plausibly matches the question need the pixels, which React Native
   * cannot read, so those happen on the API — and are honestly reported as not
   * done when no API is configured.
   *
   * A `fail` sends the verifier back to retake. A `warn` is shown and can be
   * overridden, because the cost of wrongly blocking someone who really did
   * walk to the place is far higher than the cost of a soft photo getting
   * through to an asker who can query it.
   */
  async function submitEvidence() {
    if (shots.length === 0) return;
    tap();
    setPageState('ai_checking');

    const next = attempt + 1;
    setAttempt(next);

    const result = await runEvidenceGate({
      kind: media === 'video' ? 'video' : 'photo',
      files: shots,
      question: askedQuestion,
      placeName: task!.location,
      captured: coords,
      target: targetCoords,
    });

    setReport(result);
    setPageState(result.verdict === 'pass' ? 'pending_asker' : 'check_result');
  }

  /** Sends the verifier back to the capture form to try again. */
  function retake() {
    tap();
    setShots([]);
    setReport(null);
    setCameraError(null);
    setPageState('form');
  }

  async function handleAccept() {
    // Restricted jobs are refused here as well as hidden in the UI, so the
    // rule holds even if something routes past the disabled button.
    if (task!.verifiedOnly && identity.status !== 'verified') return;

    tap(Haptics.ImpactFeedbackStyle.Heavy);
    acceptTask(task!.id);
    setPageState('locating');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        try {
          const [geo] = await Location.reverseGeocodeAsync({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
          setPlace(geo?.district ?? geo?.city ?? 'Current location');
        } catch {
          setPlace(`${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}`);
        }
      } else {
        setPlace('Location not shared');
      }
    } catch {
      setPlace('Location unavailable');
    }
    setPageState('countdown');
  }

  // ── Earned ────────────────────────────────────────────────────────────────
  if (pageState === 'earned') {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Breath>
          <View style={[styles.stamp, { backgroundColor: colors.primary }]}>
            <Ionicons name="checkmark" size={44} color={colors.primaryForeground} />
          </View>
        </Breath>
        <Text style={[text.title, { color: colors.mutedForeground, marginTop: 26 }]}>
          Done. You earned
        </Text>
        <Text style={[text.amountLarge, { color: colors.foreground, fontSize: 52 }]}>
          ₦{yourCut}
        </Text>
        <Text
          style={[text.bodySmall, { color: colors.mutedForeground, textAlign: 'center', maxWidth: 280 }]}
        >
          Paid out on Base. The {FEE_PERCENT} platform fee has already been taken off.
        </Text>
        <Pressable
          onPress={() => router.replace('/(tabs)/earn')}
          style={({ pressed }) => [
            styles.wideBtn,
            { backgroundColor: colors.foreground, opacity: pressed ? 0.88 : 1, marginTop: 30 },
          ]}
        >
          <Text style={[text.action, { color: colors.background }]}>Find another job</Text>
        </Pressable>
      </View>
    );
  }

  // ── Running the checks ────────────────────────────────────────────────────
  if (pageState === 'ai_checking') {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Breath>
          <View style={[styles.glyph, { borderColor: colors.borderStrong }]}>
            <Ionicons name="scan-outline" size={34} color={colors.foreground} />
          </View>
        </Breath>
        <Text style={[text.title, { color: colors.foreground, marginTop: 24, textAlign: 'center' }]}>
          Checking your {media ?? 'evidence'}
        </Text>
        <Text
          style={[
            text.body,
            { color: colors.mutedForeground, textAlign: 'center', maxWidth: 300 },
          ]}
        >
          {hasApi
            ? 'Looking at how clear it is, how far you were from the place, and whether it matches the question.'
            : 'Checking the length and how far you were from the place.'}
        </Text>
        <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 18 }} />
      </View>
    );
  }

  // ── What the checks found ─────────────────────────────────────────────────
  if (pageState === 'check_result' && report) {
    const failed = report.verdict === 'fail';
    const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attempt);
    const outOfTries = failed && attemptsLeft === 0;

    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingTop: topPad }]}
        >
          <Text
            style={[text.label, { color: failed ? colors.danger : colors.pending, marginTop: 18 }]}
          >
            {failed ? 'Not sent' : 'Have a look first'}
          </Text>
          <Text style={[text.display, { color: colors.foreground, marginTop: 6 }]}>
            {failed ? 'Take it again.' : 'This might be a problem.'}
          </Text>
          <Text style={[text.body, { color: colors.mutedForeground, marginTop: 10 }]}>
            {failed
              ? 'Nothing was sent to the asker and the job is still yours. The clock is still running, so go again now.'
              : 'None of this stops you sending it. You were there and you know what you saw — if it is right, send it.'}
          </Text>

          <View style={[styles.checkList, { borderColor: colors.border }]}>
            {report.checks.map((check) => (
              <CheckRow key={check.name} check={check} colors={colors} />
            ))}
          </View>

          {failed && !outOfTries && (
            <Text style={[text.data, { color: colors.faintForeground, marginTop: 12 }]}>
              {attemptsLeft === 1
                ? 'One more attempt on this job.'
                : `${attemptsLeft} more attempts on this job.`}
            </Text>
          )}

          {outOfTries ? (
            <>
              {/* Retrying forever would let a job be held while the asker's
                  deadline runs down, so the job goes back to the pool. */}
              <Text style={[text.body, { color: colors.mutedForeground, marginTop: 16 }]}>
                That is the last attempt on this one. The job goes back so somebody else can try —
                nothing is charged to you, and it does not count against your record.
              </Text>
              <Pressable
                onPress={() => router.replace('/(tabs)/earn')}
                style={({ pressed }) => [
                  styles.wideBtn,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1, marginTop: 22 },
                ]}
              >
                <Text style={[text.action, { color: colors.primaryForeground }]}>
                  Find another job
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={retake}
                style={({ pressed }) => [
                  styles.wideBtn,
                  {
                    backgroundColor: failed ? colors.primary : colors.surface,
                    borderWidth: failed ? 0 : 2,
                    borderColor: colors.borderStrong,
                    opacity: pressed ? 0.88 : 1,
                    marginTop: 22,
                  },
                ]}
              >
                <Text
                  style={[
                    text.action,
                    { color: failed ? colors.primaryForeground : colors.foreground },
                  ]}
                >
                  {media === 'video' ? 'Record it again' : 'Take it again'}
                </Text>
              </Pressable>

              {/* Override, warnings only. A machine opinion never blocks a
                  payment on its own — see the relevance check on the API. */}
              {!failed && (
                <Pressable
                  onPress={() => {
                    tap(Haptics.ImpactFeedbackStyle.Medium);
                    setPageState('pending_asker');
                  }}
                  style={({ pressed }) => [
                    styles.wideBtn,
                    {
                      backgroundColor: colors.primary,
                      opacity: pressed ? 0.88 : 1,
                      marginTop: 10,
                    },
                  ]}
                >
                  <Text style={[text.action, { color: colors.primaryForeground }]}>
                    Send it anyway · claim ₦{yourCut}
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── Waiting on asker ──────────────────────────────────────────────────────
  if (pageState === 'pending_asker') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingTop: topPad }]}
        >
          <View style={styles.bar}>
            <Pressable
              onPress={() => router.back()}
              style={[styles.backBtn, { borderColor: colors.border }]}
            >
              <Ionicons name="arrow-back" size={18} color={colors.foreground} />
            </Pressable>
          </View>

          <Text style={[text.label, { color: colors.pending, marginTop: 18 }]}>Submitted</Text>
          <Text style={[text.display, { color: colors.foreground, marginTop: 6 }]}>
            Now we wait for the asker.
          </Text>
          {/* Only claims a clean check when there actually was one. A report
              with warnings the verifier overrode, or with checks that never
              ran, must not be described as having passed. */}
          <Text style={[text.body, { color: colors.mutedForeground, marginTop: 10 }]}>
            {report?.verdict === 'pass'
              ? `Your ${media ?? 'evidence'} passed every check and has been sent. You get paid the moment they confirm it — usually within minutes.`
              : `Your ${media ?? 'evidence'} has been sent. You get paid the moment they confirm it — usually within minutes.`}
          </Text>

          {report && report.verdict !== 'pass' && (
            <View style={[styles.checkList, { borderColor: colors.border }]}>
              {report.checks
                .filter((c) => c.verdict !== 'pass')
                .map((check) => (
                  <CheckRow key={check.name} check={check} colors={colors} />
                ))}
            </View>
          )}

          <View style={[styles.ledger, { borderColor: colors.border }]}>
            {[
              { k: 'Job pays', v: `₦${task.reward}`, tone: colors.foreground },
              { k: `Platform fee (${FEE_PERCENT})`, v: `−₦${fee}`, tone: colors.mutedForeground },
            ].map((r) => (
              <View key={r.k} style={[styles.ledgerRow, { borderBottomColor: colors.border }]}>
                <Text style={[text.body, { color: colors.mutedForeground, flex: 1 }]}>{r.k}</Text>
                <Text style={[text.dataMedium, { fontSize: 14, color: r.tone }]}>{r.v}</Text>
              </View>
            ))}
            <View style={[styles.ledgerRow, { borderBottomWidth: 0 }]}>
              <Text style={[text.heading, { color: colors.foreground, flex: 1 }]}>You get</Text>
              <Text style={[text.amount, { color: colors.money }]}>₦{yourCut}</Text>
            </View>
          </View>

          <Text style={[text.bodySmall, { color: colors.faintForeground, marginTop: 16 }]}>
            If the asker queries your answer, a person reviews both sides before anything is
            reversed.
          </Text>

          <Pressable
            onPress={() => {
              completeTask(task!.id, yourCut, `${task!.title} · ${task!.location}`);
              setPageState('earned');
            }}
            style={({ pressed }) => [
              styles.wideBtn,
              { backgroundColor: colors.foreground, opacity: pressed ? 0.88 : 1, marginTop: 26 },
            ]}
          >
            <Text style={[text.action, { color: colors.background }]}>Got it</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── Locating ──────────────────────────────────────────────────────────────
  if (pageState === 'locating') {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Breath>
          <View style={[styles.glyph, { borderColor: colors.borderStrong }]}>
            <Ionicons name="navigate-outline" size={32} color={colors.foreground} />
          </View>
        </Breath>
        <Text style={[text.title, { color: colors.foreground, marginTop: 24, textAlign: 'center' }]}>
          Finding where you are
        </Text>
        <Text
          style={[text.body, { color: colors.mutedForeground, textAlign: 'center', maxWidth: 290 }]}
        >
          So the asker can see someone is genuinely on the way.
        </Text>
      </View>
    );
  }

  // ── Countdown ─────────────────────────────────────────────────────────────
  if (pageState === 'countdown') {
    const low = startIn <= 10;
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.countdown, { paddingTop: topPad + 24 }]}>
          <Text style={[text.label, { color: colors.primary }]}>You got it first</Text>

          <Text style={[text.display, { color: colors.foreground, textAlign: 'center' }]}>
            Start heading there
          </Text>

          <Text
            style={[
              styles.bigNumber,
              { color: low ? colors.danger : colors.foreground },
            ]}
          >
            {startIn}
          </Text>
          <Text style={[text.bodySmall, { color: colors.mutedForeground, textAlign: 'center' }]}>
            The job goes back to everyone else if you do not start in time.
          </Text>

          <View style={[styles.locBox, { borderColor: colors.border }]}>
            <Ionicons name="location" size={15} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[text.subheading, { color: colors.foreground }]}>
                {place || 'Location acquired'}
              </Text>
              {coords && (
                <Text style={[text.data, { color: colors.faintForeground }]}>
                  {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                </Text>
              )}
            </View>
          </View>

          <View style={[styles.jobStrip, { borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[text.subheading, { color: colors.foreground }]} numberOfLines={1}>
                {task.title}
              </Text>
              <Text style={[text.data, { color: colors.faintForeground }]} numberOfLines={1}>
                {task.location}
              </Text>
            </View>
            <Text style={[text.amount, { color: colors.money }]}>₦{yourCut}</Text>
          </View>

          <Pressable
            onPress={() => setPageState('form')}
            style={({ pressed }) => [
              styles.wideBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
            ]}
          >
            <Text style={[text.action, { color: colors.primaryForeground }]}>
              I am on my way
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Detail + form ─────────────────────────────────────────────────────────
  const urgent = expiry < 120;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingTop: topPad }]}
      >
        <View style={styles.bar}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { borderColor: colors.border }]}
          >
            <Ionicons name="arrow-back" size={18} color={colors.foreground} />
          </Pressable>
          <View style={[styles.clockChip, { borderColor: urgent ? colors.danger : colors.border }]}>
            <Ionicons
              name="time-outline"
              size={12}
              color={urgent ? colors.danger : colors.mutedForeground}
            />
            <Text
              style={[text.dataMedium, { color: urgent ? colors.danger : colors.mutedForeground }]}
            >
              {clock(expiry)}
            </Text>
          </View>
        </View>

        {pageState === 'detail' ? (
          <>
            <Text style={[text.label, { color: categoryTint, marginTop: 20 }]}>
              {task.category} · {task.distance} away · {task.estimatedTime}
            </Text>
            <Text style={[text.display, { color: colors.foreground, marginTop: 8 }]}>
              {task.title}
            </Text>
            <Text style={[text.subheading, { color: colors.mutedForeground, marginTop: 8 }]}>
              {task.location}
            </Text>

            <Text style={[text.body, { color: colors.foreground, marginTop: 20, fontSize: 15.5 }]}>
              {task.description}
            </Text>

            <View style={[styles.payBox, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}>
              <View style={{ flex: 1 }}>
                <Text style={[text.label, { color: colors.primary }]}>You keep</Text>
                <Text style={[text.amountLarge, { color: colors.foreground, marginTop: 2 }]}>
                  ₦{yourCut}
                </Text>
              </View>
              <Text style={[text.data, { color: colors.mutedForeground, textAlign: 'right' }]}>
                ₦{task.reward} job{'\n'}−₦{fee} fee
              </Text>
            </View>

            {task.askerName && (
              <View style={[styles.watchRow, { borderColor: colors.border }]}>
                <Ionicons name="person-outline" size={14} color={colors.mutedForeground} />
                <Text style={[text.bodySmall, { color: colors.mutedForeground, flex: 1 }]}>
                  Asked by{' '}
                  <Text style={{ color: colors.foreground, fontFamily: font.sansMedium }}>
                    {task.askerName}
                  </Text>
                  . You will not need to contact them.
                </Text>
              </View>
            )}

            <View style={[styles.watchRow, { borderColor: colors.border }]}>
              <Ionicons name="eye-outline" size={14} color={colors.pending} />
              <Text style={[text.bodySmall, { color: colors.mutedForeground, flex: 1 }]}>
                <Text style={{ fontFamily: font.monoMedium, color: colors.foreground }}>
                  {watchers}
                </Text>
                {' others are looking at this. First to accept gets it, and it locks to them.'}
              </Text>
            </View>

            {locked ? (
              <Pressable
                onPress={() => router.push('/verify-identity')}
                style={({ pressed }) => [
                  styles.lockedBox,
                  { borderColor: colors.pending, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Ionicons name="lock-closed" size={16} color={colors.pending} />
                <View style={{ flex: 1 }}>
                  <Text style={[text.heading, { color: colors.pending }]}>
                    Verified people only
                  </Text>
                  <Text style={[text.bodySmall, { color: colors.mutedForeground }]}>
                    The asker restricted this one. Verify your NIN to take jobs like it.
                  </Text>
                </View>
                <Ionicons name="arrow-forward" size={16} color={colors.pending} />
              </Pressable>
            ) : (
              <View style={styles.btnRow}>
                <Pressable
                  onPress={() => router.back()}
                  style={({ pressed }) => [
                    styles.declineBtn,
                    { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[text.action, { color: colors.mutedForeground }]}>Not me</Text>
                </Pressable>
                <Pressable
                  onPress={handleAccept}
                  style={({ pressed }) => [
                    styles.acceptBtn,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
                  ]}
                >
                  <Text style={[text.action, { color: colors.primaryForeground }]}>
                    I will go now
                  </Text>
                </Pressable>
              </View>
            )}
          </>
        ) : (
          <>
            <Text style={[text.label, { color: colors.faintForeground, marginTop: 20 }]}>
              What did you find?
            </Text>
            <Text style={[text.display, { color: colors.foreground, marginTop: 6 }]}>
              {task.title}
            </Text>

            {place ? (
              <View style={[styles.locBox, { borderColor: colors.border, marginTop: 18 }]}>
                <Ionicons name="location" size={15} color={colors.primary} />
                <Text style={[text.bodySmall, { color: colors.mutedForeground, flex: 1 }]}>
                  Answering from{' '}
                  <Text style={{ color: colors.foreground, fontFamily: font.sansMedium }}>
                    {place}
                  </Text>
                </Text>
              </View>
            ) : null}

            {task.questions.map((q) => (
              <View key={q.id} style={styles.question}>
                <Text style={[text.heading, { color: colors.foreground, marginBottom: 10 }]}>
                  {q.label}
                </Text>
                {q.type === 'boolean' ? (
                  <View style={[styles.segmented, { borderColor: colors.borderStrong }]}>
                    {['Yes', 'No'].map((opt, i) => {
                      const on = answers[q.id] === opt;
                      return (
                        <Pressable
                          key={opt}
                          onPress={() => {
                            if (Platform.OS !== 'web') Haptics.selectionAsync();
                            setAnswers((a) => ({ ...a, [q.id]: opt }));
                          }}
                          style={[
                            styles.segment,
                            i > 0 && { borderLeftWidth: 2, borderLeftColor: colors.borderStrong },
                            on && { backgroundColor: colors.foreground },
                          ]}
                        >
                          <Text
                            style={[
                              text.action,
                              { color: on ? colors.background : colors.mutedForeground },
                            ]}
                          >
                            {opt}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <TextInput
                    style={[
                      styles.field,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        fontFamily: q.type === 'number' ? font.monoMedium : font.sans,
                      },
                    ]}
                    placeholder={q.placeholder ?? ''}
                    placeholderTextColor={colors.faintForeground}
                    keyboardType={q.type === 'number' ? 'numeric' : 'default'}
                    value={answers[q.id] ?? ''}
                    onChangeText={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                  />
                )}
              </View>
            ))}

            {/* Proof */}
            <Text style={[text.heading, { color: colors.foreground, marginTop: 26 }]}>
              Show us
            </Text>
            <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 3 }]}>
              Video gets accepted far more often than a photo.
            </Text>

            <View style={styles.mediaRow}>
              {(['photo', 'video'] as const).map((kind) => {
                const on = media === kind;
                return (
                  <Pressable
                    key={kind}
                    onPress={() => {
                      setMedia(kind);
                      setShots([]);
                      setCameraError(null);
                      if (Platform.OS !== 'web') Haptics.selectionAsync();
                      // Tips before the camera, not after: advice about how to
                      // frame a shot is useless once the shot is taken.
                      setTipsOpen(true);
                    }}
                    style={[
                      styles.mediaOption,
                      {
                        borderColor: on ? colors.foreground : colors.border,
                        backgroundColor: on ? colors.sunken : 'transparent',
                        borderWidth: on ? 2 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name={kind === 'video' ? 'videocam-outline' : 'camera-outline'}
                      size={20}
                      color={on ? colors.foreground : colors.mutedForeground}
                    />
                    <Text
                      style={[
                        text.subheading,
                        { color: on ? colors.foreground : colors.mutedForeground },
                      ]}
                    >
                      {kind === 'video' ? 'Video' : 'Photo'}
                    </Text>
                    {kind === 'video' && (
                      <Text style={[text.data, { color: colors.primary }]}>+15%</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {shots.length > 0 && (
              <View style={[styles.proofBox, { borderColor: colors.primary }]}>
                <View style={styles.proofHead}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                  <Text style={[text.subheading, { color: colors.primary, flex: 1 }]}>
                    {media === 'video'
                      ? `Video recorded${shots[0].seconds ? ` · ${shots[0].seconds}s` : ''}`
                      : `${shots.length} of ${MAX_PHOTOS} photos`}
                  </Text>
                </View>

                {media === 'photo' ? (
                  <View style={styles.thumbRow}>
                    {shots.map((shot, i) => (
                      <View key={shot.uri} style={styles.thumbWrap}>
                        <Image source={{ uri: shot.uri }} style={styles.thumb} contentFit="cover" />
                        <Pressable
                          onPress={() => setShots((prev) => prev.filter((_, n) => n !== i))}
                          hitSlop={8}
                          accessibilityLabel={`Remove photo ${i + 1}`}
                          style={[styles.thumbX, { backgroundColor: colors.background }]}
                        >
                          <Ionicons name="close" size={12} color={colors.foreground} />
                        </Pressable>
                      </View>
                    ))}

                    {shots.length < MAX_PHOTOS && (
                      <Pressable
                        onPress={() => setTipsOpen(true)}
                        style={[styles.thumbAdd, { borderColor: colors.borderStrong }]}
                      >
                        <Ionicons name="add" size={20} color={colors.mutedForeground} />
                      </Pressable>
                    )}
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setTipsOpen(true)}
                    style={({ pressed }) => [styles.retake, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Ionicons name="refresh" size={14} color={colors.mutedForeground} />
                    <Text style={[text.data, { color: colors.mutedForeground }]}>
                      Record it again
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            {busy && (
              <View style={styles.busyRow}>
                <ActivityIndicator size="small" color={colors.mutedForeground} />
                <Text style={[text.data, { color: colors.mutedForeground }]}>
                  Shrinking the photo for upload…
                </Text>
              </View>
            )}

            {cameraError && (
              <Text style={[text.bodySmall, { color: colors.danger, marginTop: 8 }]}>
                {cameraError}
              </Text>
            )}

            {/* The job promises photo or video proof, so there is nothing to
                send without it. */}
            <Pressable
              onPress={submitEvidence}
              disabled={shots.length === 0}
              style={({ pressed }) => [
                styles.wideBtn,
                {
                  backgroundColor: shots.length ? colors.primary : colors.sunken,
                  opacity: pressed ? 0.88 : 1,
                  marginTop: 26,
                },
              ]}
            >
              <Text
                style={[
                  text.action,
                  { color: shots.length ? colors.primaryForeground : colors.faintForeground },
                ]}
              >
                {shots.length ? `Send it · claim ₦${yourCut}` : 'Add proof to send'}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {/* ── How to capture it ──────────────────────────────────────
          Shown before the camera opens. The video rule is the important
          one: saying today's date out loud is the cheapest proof that the
          clip was not recorded last week and reused. */}
      <Modal
        visible={tipsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTipsOpen(false)}
      >
        <Pressable
          style={[styles.tipsBackdrop, { backgroundColor: colors.overlay }]}
          onPress={() => setTipsOpen(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.tipsSheet,
              { backgroundColor: colors.background, borderColor: colors.borderStrong },
            ]}
          >
            <Text style={[text.label, { color: colors.accent }]}>
              Before you {media === 'video' ? 'record' : 'shoot'}
            </Text>
            <Text style={[styles.tipsTitle, { color: colors.foreground }]}>
              {media === 'video' ? 'Make the video count' : 'Make the photo count'}
            </Text>

            <View style={styles.tipsList}>
              {CAPTURE_TIPS[media === 'video' ? 'video' : 'photo'].map((tip) => (
                <View key={tip.lead} style={styles.tipRow}>
                  <View
                    style={[
                      styles.tipIcon,
                      { borderColor: tip.key ? colors.accent : colors.border },
                    ]}
                  >
                    <Ionicons
                      name={tip.icon}
                      size={15}
                      color={tip.key ? colors.accent : colors.mutedForeground}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        text.subheading,
                        { color: tip.key ? colors.accent : colors.foreground },
                      ]}
                    >
                      {tip.lead}
                    </Text>
                    <Text style={[text.data, { color: colors.mutedForeground, marginTop: 2 }]}>
                      {tip.body}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <Pressable
              onPress={capture}
              style={({ pressed }) => [
                styles.tipsGo,
                { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
              ]}
            >
              <Ionicons
                name={media === 'video' ? 'videocam' : 'camera'}
                size={16}
                color={colors.primaryForeground}
              />
              <Text style={[text.action, { color: colors.primaryForeground }]}>
                {media === 'video' ? 'Start recording' : 'Open camera'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setTipsOpen(false)}
              style={({ pressed }) => [
                styles.tipsAlt,
                { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[text.action, { color: colors.mutedForeground }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 44 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },

  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },

  payBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 2,
    borderRadius: 2,
    padding: 18,
    marginTop: 24,
  },
  watchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginTop: 12,
  },

  btnRow: { flexDirection: 'row', gap: 10, marginTop: 26 },
  lockedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderRadius: 2,
    padding: 14,
    marginTop: 26,
  },
  declineBtn: {
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 15,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  acceptBtn: {
    flex: 1,
    borderRadius: 2,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkList: { borderWidth: 2, borderRadius: 2, marginTop: 20 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  wideBtn: {
    borderRadius: 2,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },

  question: { marginTop: 26 },
  segmented: { flexDirection: 'row', borderWidth: 2, borderRadius: 2, overflow: 'hidden' },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  field: {
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 15,
    paddingVertical: 13,
    fontSize: 15,
  },

  mediaRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  mediaOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 2,
    paddingVertical: 18,
  },
  proofBox: { borderWidth: 2, borderRadius: 2, padding: 12, gap: 11, marginTop: 12 },
  proofHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumbWrap: { width: 62, height: 62 },
  thumb: { width: 62, height: 62, borderRadius: 2 },
  thumbX: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbAdd: {
    width: 62,
    height: 62,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retake: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },

  tipsBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  tipsSheet: {
    width: '100%',
    maxWidth: 400,
    borderWidth: 2,
    borderRadius: 2,
    padding: 20,
  },
  tipsTitle: { fontFamily: font.sansBold, fontSize: 22, lineHeight: 27, marginTop: 2 },
  tipsList: { gap: 14, marginTop: 18 },
  tipRow: { flexDirection: 'row', gap: 11 },
  tipIcon: {
    width: 30,
    height: 30,
    borderWidth: 2,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  tipsGo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 2,
    paddingVertical: 15,
    marginTop: 22,
  },
  tipsAlt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 14,
    marginTop: 9,
  },

  capture: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 26,
    marginTop: 10,
  },

  ledger: { borderWidth: 2, borderRadius: 2, marginTop: 24 },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },

  stamp: {
    width: 96,
    height: 96,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    width: 88,
    height: 88,
    borderRadius: 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  countdown: { flex: 1, alignItems: 'center', paddingHorizontal: 24, gap: 14 },
  bigNumber: { fontFamily: font.monoMedium, fontSize: 76, letterSpacing: -3, lineHeight: 84 },
  locBox: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  jobStrip: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
});
