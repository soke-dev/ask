import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import { AgentTrace, TraceStep } from '@/components/AgentTrace';
import { PlacePicker } from '@/components/PlacePicker';
import { QuestionRow } from '@/components/QuestionRow';
import {
  findCachedAnswer,
  placeForQuestion,
  stateForArea,
  useApp,
  type CachedAnswer,
  type Place,
  type Visibility,
} from '@/contexts/AppContext';
import {
  DEADLINE_PRESETS,
  DEFAULT_DEADLINE,
  MAX_DEADLINE,
  MIN_DEADLINE,
  formatDuration,
} from '@/constants/time';
import {
  BOUNTY_PRESETS,
  DEFAULT_BOUNTY,
  MAX_BOUNTY,
  MAX_TIP,
  MIN_BOUNTY,
  MIN_TIP,
  NAIRA_PER_USD,
  VERIFIED_ONLY_ABOVE,
  TIP_PRESETS,
  formatNaira,
  pickupHint,
  toUsd,
  verifierCut,
} from '@/constants/money';
import { localityOf } from '@/utils/places';
import { tidyQuestion } from '@/utils/tidyQuestion';

type ScreenState = 'idle' | 'working' | 'found_answer' | 'needs_verification';


const INITIAL_STEPS: TraceStep[] = [
  { label: 'Reading your question', status: 'pending' },
  { label: 'Checking what is already online', status: 'pending' },
  { label: 'Looking for recent reports nearby', status: 'pending' },
  { label: 'Deciding if someone must go look', status: 'pending' },
];

/** How many feed rows to show before it stops being a glance. */
const FEED_LIMIT = 5;

function LiveDot({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.2, duration: 950, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 950, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);
  return <Animated.View style={[styles.liveDot, { opacity, backgroundColor: color }]} />;
}

export default function AskScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    addQuery,
    dispatchQuery,
    tipVerifier,
    nearbyTasks,
    homeArea,
    questionsNearby,
    answeredNearby,
    activeQuestions,
    unreadCount,
    answersPublicByDefault,
    profile,
    ngnPerUsd,
  } = useApp();

  // The live rate when we have one, the fallback constant only until then, so
  // this screen and the wallet never quote two different numbers.
  const rate = ngnPerUsd ?? NAIRA_PER_USD;

  /**
   * Both halves of this used to be invented: it always said "afternoon", and
   * it always said "Akin". The hour now comes from the clock and the name from
   * the signed-in profile — and with no username yet it greets without one
   * rather than guessing at who is holding the phone.
   */
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    const partOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    return profile.username ? `Good ${partOfDay}, ${profile.username}` : `Good ${partOfDay}`;
  }, [profile.username]);

  /** Fresh reads green, half a day old reads red. */
  const ageTone = (hours: number) =>
    hours <= 2 ? colors.primary : hours <= 8 ? colors.pending : colors.danger;
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  const [question, setQuestion] = useState('');
  const [state, setState] = useState<ScreenState>('idle');
  const [steps, setSteps] = useState<TraceStep[]>(INITIAL_STEPS);
  const [queryId, setQueryId] = useState('');
  const [place, setPlace] = useState<Place | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [bounty, setBounty] = useState(String(DEFAULT_BOUNTY));
  const [deadline, setDeadline] = useState(String(DEFAULT_DEADLINE));
  const [visibility, setVisibility] = useState<Visibility>(
    answersPublicByDefault ? 'public' : 'private',
  );
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [cached, setCached] = useState<CachedAnswer | null>(null);
  const [tipped, setTipped] = useState(0);
  const [tipCustom, setTipCustom] = useState(false);
  const [tipDraft, setTipDraft] = useState('');

  // Captured at press time: once a fix is applied the input matches the
  // tidied text, so `canTidy` is already false and cannot report what just
  // happened.
  const [checkResult, setCheckResult] = useState<'fixed' | 'clean' | null>(null);

  const inputRef = useRef<TextInput>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bountyRef = useRef<TextInput>(null);
  const deadlineRef = useRef<TextInput>(null);
  const tipRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Set the moment a result is about to appear, then consumed by that card's
  // own onLayout. Waiting for layout is the point: the card's position is not
  // known at the time the state changes, so scrolling then would guess.
  const pendingScroll = useRef(false);

  function revealResult(event: LayoutChangeEvent) {
    if (!pendingScroll.current) return;
    pendingScroll.current = false;

    const { y } = event.nativeEvent.layout;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(y - 24, 0), animated: true });
    });
  }
  const openLive = nearbyTasks.filter((t) => t.status === 'available').length;

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      if (checkTimer.current) clearTimeout(checkTimer.current);
    },
    [],
  );

  function advance(index: number, next?: ScreenState) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i < index
          ? { ...s, status: 'complete' }
          : i === index
            ? { ...s, status: 'active' }
            : s,
      ),
    );
    if (next) {
      timers.current.push(
        setTimeout(() => {
          setSteps((prev) => prev.map((s) => ({ ...s, status: 'complete' })));
          pendingScroll.current = true;
          setState(next);
        }, 1700),
      );
    }
  }

  // A verifier has to be told where to walk to, so a question without a place
  // is not answerable. Asking is held until both are in rather than guessing
  // the place from the wording, which only ever worked for phrasings we had
  // hard-coded.
  const bountyValue = Number.parseInt(bounty, 10) || 0;
  const bountyValid = bountyValue >= MIN_BOUNTY && bountyValue <= MAX_BOUNTY;
  const isCustom = bounty !== '' && !BOUNTY_PRESETS.includes(bountyValue);

  const deadlineValue = Number.parseInt(deadline, 10) || 0;
  const deadlineValid = deadlineValue >= MIN_DEADLINE && deadlineValue <= MAX_DEADLINE;
  const isCustomDeadline = deadline === '' || !DEADLINE_PRESETS.includes(deadlineValue);

  // Big errands are restricted regardless, so the switch shows it as on and
  // stops being a choice rather than silently overriding the user later.
  const verifiedForced = bountyValue >= VERIFIED_ONLY_ABOVE;
  const verifiedOn = verifiedOnly || verifiedForced;

  // Asking costs nothing, so the only gate is a question and a place.
  const canAsk = question.trim().length > 0 && place !== null;
  const placeLocality = place ? localityOf(place) : null;

  // Saved places carry a bare area like "Ikeja", so the state is looked up and
  // appended. A searched result already ends in its state, so it is left be.
  const areaState = place ? stateForArea(place.area) : null;
  const areaLine = place ? (areaState ? `${place.area}, ${areaState}` : place.area) : '—';

  const tipDraftValue = Number.parseInt(tipDraft, 10) || 0;
  const tipDraftValid = tipDraftValue >= MIN_TIP && tipDraftValue <= MAX_TIP;

  function sendTip(amount: number, verifierName: string) {
    if (amount <= 0) return;
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    tipVerifier(amount, verifierName);
    setTipped(amount);
    setTipCustom(false);
    setTipDraft('');
  }

  function handleDispatch() {
    if (!bountyValid || !deadlineValid) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    dispatchQuery(queryId, bountyValue, visibility, deadlineValue, verifiedOnly);
    router.push(`/tracking/${queryId}`);
  }

  // Shown from the moment the box is tapped, narrowing as you type. Not tied
  // to blur: on web the input blurs on mouse-down, so hiding there would pull
  // the row out from under the click that was selecting it.
  const typed = question.trim().toLowerCase();
  const suggestions = composing
    ? questionsNearby
        .filter((q) => !typed || q.text.toLowerCase().includes(typed))
        .slice(0, FEED_LIMIT)
    : [];

  function handleAsk() {
    const q = question.trim();
    if (!q || !place) return;

    Keyboard.dismiss();
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    setComposing(false);
    setTipped(0);
    setVisibility(answersPublicByDefault ? 'public' : 'private');

    // An answer someone already paid for, but only if they let it be shared.
    const existing = findCachedAnswer(place);
    setCached(existing);

    const id = addQuery(q, place);
    setQueryId(id);
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: 'pending' })));
    setState('working');

    timers.current = [
      setTimeout(() => advance(0), 200),
      setTimeout(() => advance(1), 1700),
      setTimeout(() => advance(2), 3200),
      setTimeout(() => advance(3, existing ? 'found_answer' : 'needs_verification'), 4700),
    ];
  }

  const tidied = tidyQuestion(question);
  const canTidy = tidied !== '' && tidied !== question;

  // The button always answers when there is text to check. Silently doing
  // nothing on already-clean input is indistinguishable from being broken,
  // so a clean pass confirms itself instead.
  function handleTidy() {
    if (!question.trim()) return;
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    if (canTidy) setQuestion(tidied);

    setCheckResult(canTidy ? 'fixed' : 'clean');
    if (checkTimer.current) clearTimeout(checkTimer.current);
    checkTimer.current = setTimeout(() => setCheckResult(null), 1500);
  }

  function reset() {
    timers.current.forEach(clearTimeout);
    setState('idle');
    setQuestion('');
    setSteps(INITIAL_STEPS);
    setCached(null);
    setTipped(0);
    setTipCustom(false);
    setTipDraft('');
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingTop: topPad }]}
      >
        {/* ── Masthead ─────────────────────────────────────────────── */}
        <View style={styles.masthead}>
          <Text style={[styles.wordmark, { color: colors.foreground }]}>
            ASK<Text style={{ fontFamily: font.sans, color: colors.mutedForeground }}> NEARBY</Text>
          </Text>
          <View style={styles.mastheadRight}>
            {state !== 'idle' ? (
              <Pressable
                onPress={reset}
                hitSlop={10}
                style={[styles.ghostBtn, { borderColor: colors.border }]}
              >
                <Ionicons name="close" size={17} color={colors.mutedForeground} />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => router.push('/notifications')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={
                  unreadCount > 0 ? `Alerts, ${unreadCount} unread` : 'Alerts'
                }
                style={[styles.ghostBtn, { borderColor: colors.border }]}
              >
                <Ionicons name="notifications-outline" size={17} color={colors.mutedForeground} />
                {/* A lit corner, not a count — the number belongs on the
                    screen itself where there is room to read it. */}
                {unreadCount > 0 && (
                  <View
                    style={[
                      styles.bellDot,
                      { backgroundColor: colors.accent, borderColor: colors.background },
                    ]}
                  />
                )}
              </Pressable>
            )}
          </View>
        </View>

        {/* ── Status panel ─────────────────────────────────────────── */}
        <View style={[styles.board, { borderColor: colors.border }]}>
          <View style={styles.boardCell}>
            <LiveDot color={colors.primary} />
            <Text style={[styles.reading, { color: colors.foreground }]}>23</Text>
            <Text style={[styles.cellLabel, { color: colors.faintForeground }]}>
              Verifiers{'\n'}online
            </Text>
          </View>

          <View style={[styles.boardDivider, { backgroundColor: colors.border }]} />

          <View style={styles.boardCell}>
            <Text style={[styles.reading, { color: colors.accent }]}>{openLive}</Text>
            <Text style={[styles.cellLabel, { color: colors.faintForeground }]}>
              Jobs{'\n'}around you
            </Text>
          </View>
        </View>

        {state === 'idle' && (
          <>
            {/* ── Headline ─────────────────────────────────────────── */}
            <Text style={[text.bodySmall, styles.greeting, { color: colors.mutedForeground }]}>
              {greeting}
            </Text>
            <Text style={[text.display, styles.headline, { color: colors.foreground }]}>
              What do you need{'\n'}
              <Text style={{ color: colors.accent }}>checked</Text> right now?
            </Text>

            {/* ── The ask ──────────────────────────────────────────── */}
            <View
              style={[
                styles.composer,
                { backgroundColor: colors.surface, borderColor: colors.borderStrong },
              ]}
            >
              <View>
                <TextInput
                  ref={inputRef}
                  style={[text.body, styles.composerInput, { color: colors.foreground }]}
                  placeholder="Ask about any place, right now…"
                  placeholderTextColor={colors.faintForeground}
                  value={question}
                  onChangeText={setQuestion}
                  onFocus={() => setComposing(true)}
                  multiline
                  returnKeyType="send"
                  onSubmitEditing={() => handleAsk()}
                />

                {/* Sits over the field, appearing only once there is text to
                    act on, so an empty composer stays uncluttered. */}
                {question.trim().length > 0 && (
                  <Pressable
                    onPress={handleTidy}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Fix typos in your question"
                    style={({ pressed }) => [styles.wandBtn, { opacity: pressed ? 0.5 : 1 }]}
                  >
                    <Ionicons
                      name={checkResult ? 'checkmark' : 'color-wand-outline'}
                      size={18}
                      color={checkResult ? colors.primary : colors.mutedForeground}
                    />
                  </Pressable>
                )}
              </View>

              <View style={[styles.composerFoot, { borderTopColor: colors.border }]}>
                <Pressable
                  onPress={() => setPickerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Choose the place to check"
                  style={({ pressed }) => [
                    styles.placeChip,
                    {
                      borderColor: place ? colors.primary : colors.border,
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={place ? 'location' : 'location-outline'}
                    size={13}
                    color={place ? colors.primary : colors.faintForeground}
                  />
                  <Text
                    style={[
                      text.data,
                      { color: place ? colors.foreground : colors.faintForeground, flexShrink: 1 },
                    ]}
                    numberOfLines={1}
                  >
                    {place ? place.name : 'Add a place'}
                    {/* Which Chicken Republic? The branch name alone is not
                        enough to send somebody to. */}
                    {placeLocality && (
                      <Text style={{ color: colors.mutedForeground }}> · {placeLocality}</Text>
                    )}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => handleAsk()}
                  disabled={!canAsk}
                  style={({ pressed }) => [
                    styles.sendBtn,
                    {
                      backgroundColor: canAsk ? colors.accent : colors.sunken,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      text.action,
                      { color: canAsk ? colors.accentForeground : colors.faintForeground },
                    ]}
                  >
                    Ask
                  </Text>
                  <Ionicons
                    name="arrow-forward"
                    size={15}
                    color={canAsk ? colors.accentForeground : colors.faintForeground}
                  />
                </Pressable>
              </View>
            </View>

            {/* Never leave Ask greyed out without saying what is missing. */}
            {question.trim().length > 0 && !place && (
              <Pressable onPress={() => setPickerOpen(true)} style={styles.askHint}>
                <Ionicons name="arrow-up" size={13} color={colors.accent} />
                <Text style={[text.bodySmall, { color: colors.accent, flex: 1 }]}>
                  Pick the place you want checked, then you can ask.
                </Text>
              </Pressable>
            )}

            {/* ── Quick-pick, only while the composer is in use ────────
                Each row carries its own place, so one tap fills the question
                and the location together and Ask goes live immediately. */}
            {suggestions.length > 0 && (
              <View style={styles.suggestBox}>
                <View style={styles.suggestHead}>
                  <Text style={[text.label, { color: colors.faintForeground }]}>
                    {question.trim() ? 'Matching nearby' : 'Recently asked nearby'}
                  </Text>
                  <Pressable onPress={() => setComposing(false)} hitSlop={10}>
                    <Ionicons name="close" size={15} color={colors.faintForeground} />
                  </Pressable>
                </View>

                {suggestions.map((q) => (
                  <Pressable
                    key={q.id}
                    onPress={() => {
                      setQuestion(q.text);
                      setPlace(placeForQuestion(q));
                      setComposing(false);
                    }}
                    style={({ pressed }) => [
                      styles.prompt,
                      {
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.sunken : 'transparent',
                      },
                    ]}
                  >
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={[text.body, { color: colors.foreground }]}>{q.text}</Text>
                      <Text style={[text.data, { color: colors.faintForeground }]}>
                        {q.placeName}
                        {q.area !== homeArea.label ? ` · ${q.area}` : ''}
                      </Text>
                    </View>
                    <Ionicons name="return-down-forward" size={14} color={colors.faintForeground} />
                  </Pressable>
                ))}
              </View>
            )}

            {/* ── Questions you are waiting on ─────────────────────── */}
            {activeQuestions.length > 0 && (
              <>
                <View style={styles.feedHead}>
                  <Text style={[text.label, { color: colors.faintForeground }]}>
                    Your questions
                  </Text>
                  <Text style={[text.data, { color: colors.faintForeground }]}>
                    {activeQuestions.length}
                  </Text>
                </View>

                {/* A preview, not the list — the two most recent, then out. */}
                {activeQuestions.slice(0, 2).map((q) => (
                  <QuestionRow
                    key={q.id}
                    question={q}
                    onPress={() => router.push(`/tracking/${q.id}`)}
                  />
                ))}

                <Pressable
                  onPress={() => router.push('/my-questions')}
                  style={({ pressed }) => [
                    styles.viewAll,
                    { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[text.action, { color: colors.foreground }]}>
                    View all {activeQuestions.length}
                  </Text>
                  <Ionicons name="arrow-forward" size={14} color={colors.foreground} />
                </Pressable>
              </>
            )}

            {/* ── Answered nearby ──────────────────────────────────── */}
            <View style={styles.feedHead}>
              <Text style={[text.label, { color: colors.faintForeground }]}>Answered nearby</Text>
              <Text style={[text.data, { color: colors.faintForeground }]}>
                {homeArea.label}
              </Text>
            </View>

            <View style={styles.recentList}>
              {answeredNearby.slice(0, FEED_LIMIT).map((item) => (
                <View
                  key={item.id}
                  style={[styles.recentRow, { borderBottomColor: colors.border }]}
                >
                  <View style={{ flex: 1, gap: 7 }}>
                    <Text style={[text.subheading, { color: colors.foreground }]} numberOfLines={2}>
                      {item.text}
                    </Text>
                    {/* Facts, not a score: what proof exists, whether the
                        asker accepted it, and how stale it is. */}
                    <View style={styles.recentMeta}>
                      <Ionicons
                        name={item.confirmed ? 'checkmark-circle' : 'ellipse-outline'}
                        size={12}
                        color={item.confirmed ? colors.primary : colors.pending}
                      />
                      <Text
                        style={[
                          text.data,
                          { color: item.confirmed ? colors.primary : colors.pending },
                        ]}
                      >
                        {item.confirmed ? 'Confirmed' : 'Unconfirmed'}
                      </Text>
                      <Text style={[text.data, { color: colors.faintForeground }]}>
                        · {item.proof} · {item.ago}
                        {item.area !== homeArea.label ? ` · ${item.area}` : ''}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── Working / dispatch states ────────────────────────────── */}
        {state !== 'idle' && (
          <>
            <Text style={[text.label, styles.sectionLabel, { color: colors.faintForeground }]}>
              You asked
            </Text>
            <Text style={[text.title, styles.askedBack, { color: colors.foreground }]}>
              {question}
            </Text>

            <View
              style={[
                styles.tracePanel,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <AgentTrace steps={steps} />
            </View>
          </>
        )}

        {/* ── An answer someone already paid for ───────────────────── */}
        {state === 'found_answer' && cached && (
          <View onLayout={revealResult} style={[styles.answerCard, { borderColor: colors.primary }]}>
            <View style={styles.answerHead}>
              <Text style={[text.label, { color: colors.primary, flex: 1 }]}>
                Already answered
              </Text>
              <View style={[styles.ageTag, { borderColor: ageTone(cached.ageHours) }]}>
                <Text style={[text.dataMedium, { color: ageTone(cached.ageHours) }]}>
                  {cached.ageHours}h ago
                </Text>
              </View>
            </View>

            <Text style={[styles.answerText, { color: colors.foreground }]}>{cached.answer}</Text>
            <Text style={[text.body, { color: colors.mutedForeground }]}>{cached.detail}</Text>

            <View style={styles.answerMeta}>
              <View style={[styles.avatar, { backgroundColor: colors.sunken }]}>
                <Text style={[text.dataMedium, { color: colors.foreground }]}>
                  {cached.verifierInitials}
                </Text>
              </View>
              <Text style={[text.bodySmall, { color: colors.mutedForeground, flex: 1 }]}>
                {cached.verifierName} went and checked · {cached.proof} proof
                {cached.confirmed ? ' · confirmed by the asker' : ' · not confirmed'}
              </Text>
            </View>

            {tipped > 0 ? (
              <View style={[styles.tipDone, { borderColor: colors.primary }]}>
                <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                <Text style={[text.subheading, { color: colors.primary, flex: 1 }]}>
                  ₦{formatNaira(tipped)} tipped to {cached.verifierName}
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.tipRow}>
                  <Text style={[text.data, { color: colors.faintForeground }]}>Tip</Text>
                  {TIP_PRESETS.map((amount) => (
                    <Pressable
                      key={amount}
                      onPress={() => sendTip(amount, cached.verifierName)}
                      style={({ pressed }) => [
                        styles.tipBtn,
                        { borderColor: colors.borderStrong, opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <Text style={[text.dataMedium, { color: colors.foreground }]}>
                        ₦{amount}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => {
                      setTipCustom(true);
                      setTipDraft('');
                      requestAnimationFrame(() => tipRef.current?.focus());
                    }}
                    style={({ pressed }) => [
                      styles.tipBtn,
                      {
                        borderColor: tipCustom ? colors.foreground : colors.borderStrong,
                        backgroundColor: tipCustom ? colors.foreground : 'transparent',
                        opacity: pressed ? 0.6 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        text.dataMedium,
                        { color: tipCustom ? colors.background : colors.foreground },
                      ]}
                    >
                      Custom
                    </Text>
                  </Pressable>
                </View>

                {tipCustom && (
                  <View style={styles.tipCustomRow}>
                    <View style={[styles.tipField, { borderColor: colors.borderStrong }]}>
                      <Text style={[styles.tipSymbol, { color: colors.foreground }]}>₦</Text>
                      <TextInput
                        ref={tipRef}
                        style={[styles.tipInput, { color: colors.foreground }]}
                        value={tipDraft}
                        onChangeText={(v) => setTipDraft(v.replace(/\D/g, '').slice(0, 6))}
                        keyboardType="numeric"
                        placeholder="500"
                        placeholderTextColor={colors.faintForeground}
                      />
                      {/* Never let the converted figure be the thing that
                          gets squeezed — a half-rendered price is worse than
                          no price, so the naira field yields instead. */}
                      <Text
                        style={[text.data, styles.tipUsd, { color: colors.faintForeground }]}
                        numberOfLines={1}
                      >
                        ${toUsd(tipDraftValue, rate)}
                      </Text>
                    </View>

                    <Pressable
                      onPress={() => sendTip(tipDraftValue, cached.verifierName)}
                      disabled={!tipDraftValid}
                      style={({ pressed }) => [
                        styles.tipConfirm,
                        {
                          backgroundColor: tipDraftValid ? colors.primary : colors.sunken,
                          opacity: pressed ? 0.85 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          text.action,
                          {
                            color: tipDraftValid
                              ? colors.primaryForeground
                              : colors.faintForeground,
                          },
                        ]}
                      >
                        Send
                      </Text>
                    </Pressable>
                  </View>
                )}
              </>
            )}

            <Pressable
              onPress={() => {
                pendingScroll.current = true;
                setState('needs_verification');
              }}
              style={({ pressed }) => [
                styles.recheckBtn,
                { borderColor: colors.accent, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="refresh" size={15} color={colors.accent} />
              <Text style={[text.action, { color: colors.accent }]}>Send someone anyway</Text>
            </Pressable>
          </View>
        )}

        {state === 'needs_verification' && (
          <View
            onLayout={revealResult}
            style={[
              styles.dispatchCard,
              { backgroundColor: colors.accentSoft, borderColor: colors.accent },
            ]}
          >
            <Text style={[text.label, { color: colors.accent }]}>No reliable answer online</Text>
            <Text style={[text.title, styles.dispatchTitle, { color: colors.foreground }]}>
              Someone has to go and look.
            </Text>
            {/* Not "we will send someone" — nobody is dispatched. The job is
                offered, and whoever takes it first is the one who goes. */}
            <Text style={[text.body, { color: colors.mutedForeground }]}>
              Your question goes to people nearby. Whoever takes it first sends photo or video
              proof.
            </Text>

            <View style={[styles.dispatchFacts, { borderColor: colors.accent + '55' }]}>
              {[
                { k: 'Where', v: place?.name ?? 'Not set' },
                { k: 'Area', v: areaLine },
                { k: 'Answer within', v: formatDuration(deadlineValue || DEFAULT_DEADLINE) },
              ].map((f, i) => (
                <View
                  key={f.k}
                  style={[
                    styles.factRow,
                    i > 0 && { borderTopWidth: 1, borderTopColor: colors.accent + '33' },
                  ]}
                >
                  <Text style={[text.bodySmall, { color: colors.mutedForeground }]}>{f.k}</Text>
                  <Text
                    style={[text.dataMedium, { color: colors.foreground, flex: 1, textAlign: 'right' }]}
                    numberOfLines={1}
                  >
                    {f.v}
                  </Text>
                </View>
              ))}
            </View>

            {/* ── What you will pay ────────────────────────────────
                Asked only here. Up to this point nothing has cost anything,
                and most questions never get this far. */}
            <View style={[styles.bountyBox, { borderColor: colors.accent + '55' }]}>
              <View style={styles.bountyTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[text.label, { color: colors.accent }]}>What will you pay?</Text>
                  <View style={styles.bountyFieldRow}>
                    <Text style={[styles.bountySymbol, { color: colors.foreground }]}>₦</Text>
                    <TextInput
                      ref={bountyRef}
                      style={[styles.bountyField, { color: colors.foreground }]}
                      value={bounty}
                      onChangeText={(v) => setBounty(v.replace(/\D/g, '').slice(0, 6))}
                      keyboardType="numeric"
                      placeholder="500"
                      placeholderTextColor={colors.faintForeground}
                      selectTextOnFocus
                    />
                  </View>
                </View>

                {/* The dollar figure and the rate behind it. A converted
                    number nobody can check is worse than none at all. */}
                <View style={styles.usdCol}>
                  <Text style={[text.amount, { color: colors.money, fontSize: 18 }]}>
                    ${toUsd(bountyValue, rate)}
                  </Text>
                  <Text style={[text.data, { color: colors.faintForeground }]}>
                    at ₦{formatNaira(Math.round(rate))}/$1
                  </Text>
                </View>
              </View>

              <View style={styles.presetRow}>
                {BOUNTY_PRESETS.map((amount) => {
                  const on = bountyValue === amount;
                  return (
                    <Pressable
                      key={amount}
                      onPress={() => setBounty(String(amount))}
                      style={[
                        styles.preset,
                        {
                          backgroundColor: on ? colors.foreground : 'transparent',
                          borderColor: on ? colors.foreground : colors.borderStrong,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          text.dataMedium,
                          { color: on ? colors.background : colors.foreground },
                        ]}
                      >
                        ₦{formatNaira(amount)}
                      </Text>
                    </Pressable>
                  );
                })}

                <Pressable
                  onPress={() => {
                    setBounty('');
                    bountyRef.current?.focus();
                  }}
                  style={[
                    styles.preset,
                    {
                      backgroundColor: isCustom ? colors.foreground : 'transparent',
                      borderColor: isCustom ? colors.foreground : colors.borderStrong,
                    },
                  ]}
                >
                  <Text
                    style={[
                      text.dataMedium,
                      { color: isCustom ? colors.background : colors.foreground },
                    ]}
                  >
                    Custom
                  </Text>
                </Pressable>
              </View>

              <Text
                style={[
                  text.data,
                  { color: bountyValid ? colors.faintForeground : colors.danger, marginTop: 10 },
                ]}
              >
                {bountyValid
                  ? `${pickupHint(bountyValue)} · verifier keeps ₦${formatNaira(verifierCut(bountyValue))}`
                  : `Enter between ₦${formatNaira(MIN_BOUNTY)} and ₦${formatNaira(MAX_BOUNTY)}`}
              </Text>

              {/* ── How long they get ──────────────────────────────
                  A deadline is what makes the money refundable: without
                  one there is no moment at which nobody has delivered. */}
              <View style={[styles.visRow, { borderTopColor: colors.accent + '33' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[text.subheading, { color: colors.foreground }]}>
                    Answer within
                  </Text>
                  <Text style={[text.data, { color: colors.faintForeground }]}>
                    Close it for a full refund if nobody delivers in time
                  </Text>
                </View>
              </View>

              <View style={styles.presetRow}>
                {DEADLINE_PRESETS.map((minutes) => {
                  const on = deadlineValue === minutes;
                  return (
                    <Pressable
                      key={minutes}
                      onPress={() => setDeadline(String(minutes))}
                      style={[
                        styles.preset,
                        {
                          backgroundColor: on ? colors.foreground : 'transparent',
                          borderColor: on ? colors.foreground : colors.borderStrong,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          text.dataMedium,
                          { fontSize: 11, color: on ? colors.background : colors.foreground },
                        ]}
                      >
                        {formatDuration(minutes)}
                      </Text>
                    </Pressable>
                  );
                })}

                <Pressable
                  onPress={() => {
                    setDeadline('');
                    deadlineRef.current?.focus();
                  }}
                  style={[
                    styles.preset,
                    {
                      backgroundColor: isCustomDeadline ? colors.foreground : 'transparent',
                      borderColor: isCustomDeadline ? colors.foreground : colors.borderStrong,
                    },
                  ]}
                >
                  <Text
                    style={[
                      text.dataMedium,
                      { fontSize: 11, color: isCustomDeadline ? colors.background : colors.foreground },
                    ]}
                  >
                    Custom
                  </Text>
                </Pressable>
              </View>

              {isCustomDeadline && (
                <View style={[styles.deadlineField, { borderColor: colors.borderStrong }]}>
                  <TextInput
                    ref={deadlineRef}
                    style={[styles.deadlineInput, { color: colors.foreground }]}
                    value={deadline}
                    onChangeText={(v) => setDeadline(v.replace(/\D/g, '').slice(0, 5))}
                    keyboardType="numeric"
                    placeholder="45"
                    placeholderTextColor={colors.faintForeground}
                  />
                  <Text style={[text.data, { color: colors.faintForeground }]}>minutes</Text>
                </View>
              )}

              {!deadlineValid && (
                <Text style={[text.data, { color: colors.danger, marginTop: 8 }]}>
                  Between {formatDuration(MIN_DEADLINE)} and {formatDuration(MAX_DEADLINE)}
                </Text>
              )}

              {/* ── Who may take it ────────────────────────────────── */}
              <View style={[styles.visRow, { borderTopColor: colors.accent + '33' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[text.subheading, { color: colors.foreground }]}>
                    Verified people only
                  </Text>
                  <Text style={[text.data, { color: colors.faintForeground }]}>
                    {verifiedForced
                      ? `Required above ₦${formatNaira(VERIFIED_ONLY_ABOVE)}`
                      : verifiedOn
                        ? 'Only people who confirmed their identity can take it'
                        : 'Anyone nearby can take it'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => !verifiedForced && setVerifiedOnly(!verifiedOnly)}
                  disabled={verifiedForced}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: verifiedOn, disabled: verifiedForced }}
                  style={[
                    styles.toggle,
                    {
                      backgroundColor: verifiedOn ? colors.primary : colors.sunken,
                      borderColor: verifiedOn ? colors.primary : colors.borderStrong,
                      opacity: verifiedForced ? 0.6 : 1,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.knob,
                      {
                        backgroundColor: verifiedOn
                          ? colors.primaryForeground
                          : colors.mutedForeground,
                        alignSelf: verifiedOn ? 'flex-end' : 'flex-start',
                      },
                    ]}
                  />
                </Pressable>
              </View>

              {/* ── Who else may see the answer ────────────────────── */}
              <View style={[styles.visRow, { borderTopColor: colors.accent + '33' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[text.subheading, { color: colors.foreground }]}>
                    Share the answer
                  </Text>
                  <Text style={[text.data, { color: colors.faintForeground }]}>
                    {visibility === 'public'
                      ? 'Others asking about this place can see it'
                      : 'Only you will ever see it'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setVisibility(visibility === 'public' ? 'private' : 'public')}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: visibility === 'public' }}
                  style={[
                    styles.toggle,
                    {
                      backgroundColor: visibility === 'public' ? colors.primary : colors.sunken,
                      borderColor: visibility === 'public' ? colors.primary : colors.borderStrong,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.knob,
                      {
                        backgroundColor:
                          visibility === 'public' ? colors.primaryForeground : colors.mutedForeground,
                        alignSelf: visibility === 'public' ? 'flex-end' : 'flex-start',
                      },
                    ]}
                  />
                </Pressable>
              </View>
            </View>

            <Pressable
              onPress={handleDispatch}
              disabled={!bountyValid || !deadlineValid}
              style={({ pressed }) => [
                styles.dispatchBtn,
                {
                  backgroundColor: bountyValid && deadlineValid ? colors.accent : colors.sunken,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}
            >
              <Text
                style={[
                  text.action,
                  {
                    color:
                      bountyValid && deadlineValid
                        ? colors.accentForeground
                        : colors.faintForeground,
                  },
                ]}
              >
                Send someone · ₦{formatNaira(bountyValue)}
              </Text>
              <Ionicons
                name="arrow-forward"
                size={16}
                color={
                  bountyValid && deadlineValid ? colors.accentForeground : colors.faintForeground
                }
              />
            </Pressable>
          </View>
        )}
      </ScrollView>

      <PlacePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(chosen) => {
          setPlace(chosen);
          setPickerOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 36 },

  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  wordmark: { fontFamily: font.sansBold, fontSize: 19, letterSpacing: 1.2 },
  mastheadRight: { flexDirection: 'row', gap: 8 },
  ghostBtn: {
    width: 36,
    height: 36,
    borderRadius: 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 10,
    height: 10,
    borderRadius: 2,
    borderWidth: 2,
  },

  // Two readings side by side rather than one run-on sentence: a count is
  // something you glance at, so the numeral leads and the label sits beside
  // it on the same line, the way a gauge is annotated.
  board: { flexDirection: 'row', borderWidth: 2, borderRadius: 2 },
  boardCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  boardDivider: { width: 2 },
  reading: { fontFamily: font.monoBold, fontSize: 24, lineHeight: 27, letterSpacing: -0.8 },
  cellLabel: {
    flex: 1,
    fontFamily: font.monoSemi,
    fontSize: 9.5,
    lineHeight: 12,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  liveDot: { width: 7, height: 7, borderRadius: 2 },

  greeting: { marginTop: 26 },
  headline: { marginTop: 6, marginBottom: 22 },

  composer: { borderWidth: 2, borderRadius: 2, overflow: 'hidden' },
  composerInput: {
    fontSize: 17,
    lineHeight: 24,
    paddingLeft: 16,
    // Room for the wand so long questions never run underneath it.
    paddingRight: 46,
    paddingTop: 16,
    paddingBottom: 14,
    minHeight: 92,
    textAlignVertical: 'top',
  },
  wandBtn: { position: 'absolute', top: 13, right: 12, padding: 2 },
  askHint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },

  bountyBox: { borderWidth: 2, borderRadius: 2, padding: 14, marginTop: 12 },
  bountyTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  bountyFieldRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  bountySymbol: { fontFamily: font.monoBold, fontSize: 24 },
  bountyField: { fontFamily: font.monoBold, fontSize: 24, minWidth: 90, padding: 0 },
  usdCol: { alignItems: 'flex-end', gap: 2, paddingTop: 14 },
  presetRow: { flexDirection: 'row', gap: 7, marginTop: 12 },
  preset: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 8,
  },
  visRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    marginTop: 14,
    paddingTop: 13,
  },
  toggle: { width: 46, height: 26, borderWidth: 2, borderRadius: 2, padding: 2 },
  knob: { width: 18, height: 18, borderRadius: 1 },

  answerCard: { borderWidth: 2, borderRadius: 2, padding: 18, marginTop: 16, gap: 10 },
  answerHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ageTag: { borderWidth: 2, borderRadius: 2, paddingHorizontal: 8, paddingVertical: 3 },
  answerText: { fontFamily: font.sansBold, fontSize: 21, lineHeight: 27 },
  answerMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 2, flexWrap: 'wrap' },
  tipBtn: { borderWidth: 2, borderRadius: 2, paddingHorizontal: 12, paddingVertical: 8 },
  tipCustomRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginTop: 8 },
  tipField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tipSymbol: { fontFamily: font.monoBold, fontSize: 16, flexShrink: 0 },
  tipInput: { flex: 1, minWidth: 40, fontFamily: font.monoBold, fontSize: 16, padding: 0 },
  tipUsd: { flexShrink: 0 },
  deadlineField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  deadlineInput: { flex: 1, fontFamily: font.monoBold, fontSize: 16, padding: 0 },
  tipConfirm: {
    justifyContent: 'center',
    borderRadius: 2,
    paddingHorizontal: 18,
  },
  tipDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  recheckBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 14,
    marginTop: 4,
  },
  composerFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 2,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 8,
  },
  placeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 2,
  },

  sectionLabel: { marginTop: 32, marginBottom: 12 },
  feedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 32,
    marginBottom: 12,
  },
  suggestBox: { marginTop: 14 },
  suggestHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 15,
    paddingVertical: 13,
    marginBottom: 8,
  },

  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 12,
    marginTop: 2,
  },

  recentList: { gap: 0 },
  recentRow: { paddingVertical: 15, borderBottomWidth: 1 },
  recentMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },

  askedBack: { marginBottom: 22 },
  tracePanel: { borderWidth: 2, borderRadius: 2, padding: 20 },

  dispatchCard: { marginTop: 16, borderWidth: 2, borderRadius: 2, padding: 20, gap: 10 },
  dispatchTitle: { marginTop: 2 },
  dispatchFacts: { borderWidth: 2, borderRadius: 2, marginTop: 6 },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  dispatchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 2,
    paddingVertical: 15,
    marginTop: 6,
  },
});
