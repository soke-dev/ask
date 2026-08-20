import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useColors, type Theme } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import { formatNaira, verifierCut } from '@/constants/money';
import { formatDuration, formatRemaining, msUntilDeadline } from '@/constants/time';
import { useApp } from '@/contexts/AppContext';
import { useRealtime, useRealtimeStatus } from '@/hooks/useRealtime';
import { VerificationCard, Verification } from '@/components/VerificationCard';

type EvidenceAction = 'confirm' | 'query' | null;

/**
 * One job locks to one verifier, so exactly one answer comes back. Several
 * people may be offered the job, but only whoever accepts it first walks
 * anywhere — and only they get paid.
 */
const RESPONSE: Verification & { id: string } = {
  id: 'v1',
  workerInitials: 'AK',
  workerName: 'Akin',
  response: 'Petrol is available, queue is moving fast.',
  detail: '₦895 per litre · about 12 cars waiting · video sent',
  timeAgo: '2 min ago',
  distance: '0.3 km away',
  mediaType: 'video',
  status: 'pending',
  idVerified: true,
  jobsDone: 218,
  capturedAt: '14:32 · 2 min ago',
  capturedNear: 'Airport Road, 40 m from the pumps',
  duration: '0:14',
  // What the gate reported on this submission. Written out rather than
  // generated so the shape matches exactly what runEvidenceGate returns, and
  // includes a skipped check because that is the normal case in a build with
  // no backend configured — the asker should see the gap, not a clean sweep.
  checks: [
    { name: 'duration', verdict: 'pass', detail: '14s long.' },
    { name: 'distance', verdict: 'pass', detail: 'Captured 40m from the place.' },
    {
      name: 'clarity',
      verdict: 'skipped',
      detail: 'Not checked for blur or lighting — this build has no server.',
    },
  ],
};

function Pulse({ color, size = 8 }: { color: string; size?: number }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.18, duration: 640, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 640, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{ opacity, width: size, height: size, borderRadius: 1, backgroundColor: color }}
    />
  );
}

/** A schematic "map" — a survey grid with a signal ping, not a fake satellite tile. */
function GroundMap({ colors, label }: { colors: Theme; label: string }) {
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(ring, { toValue: 1, duration: 2400, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [ring]);

  return (
    <View style={[map.wrap, { backgroundColor: colors.sunken, borderColor: colors.border }]}>
      {[0.2, 0.4, 0.6, 0.8].map((f) => (
        <View key={`h${f}`} style={[map.rule, { top: `${f * 100}%`, backgroundColor: colors.border }]} />
      ))}
      {[0.25, 0.5, 0.75].map((f) => (
        <View
          key={`v${f}`}
          style={[map.ruleV, { left: `${f * 100}%`, backgroundColor: colors.border }]}
        />
      ))}

      <View style={map.center}>
        <Animated.View
          style={[
            map.ripple,
            {
              borderColor: colors.accent,
              opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
              transform: [
                { scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) },
              ],
            },
          ]}
        />
        <View style={[map.pin, { backgroundColor: colors.accent }]}>
          <Ionicons name="location" size={13} color={colors.accentForeground} />
        </View>
      </View>

      <View style={[map.tag, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[text.data, { color: colors.foreground }]} numberOfLines={1}>
          {label}
        </Text>
      </View>

      <View style={[map.walker, { backgroundColor: colors.primary, top: '28%', left: '30%' }]} />
      <View style={[map.walker, { backgroundColor: colors.primary, top: '64%', left: '68%' }]} />
    </View>
  );
}

const map = StyleSheet.create({
  wrap: {
    height: 168,
    borderRadius: 2,
    borderWidth: 2,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
  },
  rule: { position: 'absolute', left: 0, right: 0, height: 1, opacity: 0.7 },
  ruleV: { position: 'absolute', top: 0, bottom: 0, width: 1, opacity: 0.7 },
  center: { alignItems: 'center', justifyContent: 'center' },
  ripple: { position: 'absolute', width: 54, height: 54, borderRadius: 2, borderWidth: 2 },
  pin: { width: 30, height: 30, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  tag: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  walker: { position: 'absolute', width: 7, height: 7, borderRadius: 2 },
});

export default function TrackingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { queries, closeQuery, openDispute, disputeForQuery } = useApp();

  /**
   * Everything about this question arrives on one topic — the task being
   * taken, the evidence landing, the dispute being answered — because the
   * database triggers route it all there.
   *
   * The handler is empty on purpose. This screen still renders from local
   * context, so there is nothing to pull yet; it gets a body when the screens
   * start reading through the API. Subscribing now is what puts the topic on
   * the socket, and keeps the connection indicator honest about this screen.
   */
  const connection = useRealtimeStatus();
  useRealtime(id ? `question:${id}` : null, () => {});
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  const query = queries.find((q) => q.id === id);
  const question = query?.question ?? 'Checking that location…';
  const place = query?.place ?? null;

  const [stepIndex, setStepIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const [showFinal, setShowFinal] = useState(false);
  const [response, setResponse] = useState({ ...RESPONSE });
  const [action, setAction] = useState<EvidenceAction>(null);
  const [confirmed, setConfirmed] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;

  // Ticks so the countdown moves and the refund offer appears the moment the
  // window closes, rather than on the next unrelated re-render.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const dispute = query ? disputeForQuery(query.id) : null;
  const msLeft = query ? msUntilDeadline(query.dispatchedAt, query.deadlineMinutes) : 0;
  const overdue = msLeft <= 0;

  const STEPS = [
    { label: 'Offered to people nearby', sub: '3 within 500 m', done: stepIndex > 0, live: stepIndex === 0 },
    { label: `${response.workerName} took the job`, sub: 'Locked to them until it expires', done: stepIndex > 1, live: stepIndex === 1 },
    { label: 'Evidence came back', sub: `${response.mediaType} proof sent`, done: stepIndex > 2, live: stepIndex === 2 },
    { label: 'Your turn to check it', sub: 'Confirm it or query it', done: confirmed, live: stepIndex === 3 && !confirmed },
    { label: 'Answer settled', sub: `${response.workerName} paid`, done: showFinal, live: stepIndex === 4 && !showFinal },
  ];

  useEffect(() => {
    const timers = [
      setTimeout(() => setStepIndex(1), 1800),
      setTimeout(() => setStepIndex(2), 4200),
      setTimeout(() => setShown(true), 5200),
      setTimeout(() => setStepIndex(3), 6000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (confirmed && !showFinal) {
      const t = setTimeout(() => setShowFinal(true), 700);
      return () => clearTimeout(t);
    }
  }, [confirmed, showFinal]);

  function handleConfirm() {
    setAction('confirm');
    setResponse((v) => ({ ...v, status: 'confirmed' }));
    setConfirmed(true);
    setStepIndex(4);
    Animated.timing(fade, { toValue: 1, duration: 380, useNativeDriver: true }).start();
  }

  function handleQuery(reason: string) {
    if (!query) return;
    setAction('query');
    setResponse((v) => ({ ...v, status: 'queried' }));

    // Real record now, not a timer. It waits on the verifier, then a person.
    openDispute({
      queryId: query.id,
      taskId: null,
      question: query.question,
      placeName: query.place?.name ?? 'Unknown place',
      bounty: query.bounty,
      verifierName: response.workerName,
      reason,
      evidence: {
        kind: response.mediaType === 'video' ? 'video' : 'photo',
        detail: response.detail,
      },
    });
  }

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
          {/* Only claims "Live" when a socket is genuinely open. With no
              backend configured this shows nothing rather than a green dot
              that means nothing. */}
          {connection === 'open' && (
            <View style={styles.liveTag}>
              <Pulse color={colors.accent} />
              <Text style={[text.label, { color: colors.accent }]}>Live</Text>
            </View>
          )}
          {connection === 'connecting' && (
            <Text style={[text.label, { color: colors.faintForeground }]}>Connecting…</Text>
          )}
          {connection === 'offline' && (
            <View style={styles.liveTag}>
              <Ionicons name="cloud-offline-outline" size={13} color={colors.pending} />
              <Text style={[text.label, { color: colors.pending }]}>Reconnecting</Text>
            </View>
          )}
        </View>

        <Text style={[text.label, { color: colors.faintForeground, marginTop: 22 }]}>
          You asked
        </Text>
        <Text style={[text.display, { color: colors.foreground, marginTop: 6 }]}>{question}</Text>

        {place && (
          <View style={styles.placeLine}>
            <Ionicons name="location" size={14} color={colors.accent} />
            <Text style={[text.subheading, { color: colors.mutedForeground, flex: 1 }]}>
              {place.name}
              <Text style={{ color: colors.faintForeground }}> · {place.area}</Text>
            </Text>
          </View>
        )}

        <GroundMap colors={colors} label={place?.name ?? 'Locating'} />

        {/* ── Progress ─────────────────────────────────────────────── */}
        <View style={styles.steps}>
          {STEPS.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepGutter}>
                <View
                  style={[
                    styles.stepMark,
                    {
                      borderColor: step.done
                        ? colors.primary
                        : step.live
                          ? colors.accent
                          : colors.border,
                      backgroundColor: step.done ? colors.primary : 'transparent',
                    },
                  ]}
                >
                  {step.done ? (
                    <Ionicons name="checkmark" size={10} color={colors.primaryForeground} />
                  ) : step.live ? (
                    <Pulse color={colors.accent} size={6} />
                  ) : null}
                </View>
                {i < STEPS.length - 1 && (
                  <View
                    style={[
                      styles.stepThread,
                      { backgroundColor: step.done ? colors.primary : colors.border },
                    ]}
                  />
                )}
              </View>

              <View style={styles.stepBody}>
                <Text
                  style={[
                    text.body,
                    {
                      color: step.live || step.done ? colors.foreground : colors.faintForeground,
                      fontFamily: step.live ? font.sansMedium : font.sans,
                    },
                  ]}
                >
                  {step.label}
                </Text>
                {(step.live || step.done) && (
                  <Text style={[text.data, { color: colors.faintForeground, marginTop: 2 }]}>
                    {step.sub}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>

        {/* ── The window ────────────────────────────────────────────
            Once evidence is in, the clock stops mattering: somebody has
            already done the walking, so the money is no longer refundable. */}
        {!showFinal && query && (
          <View
            style={[
              styles.clockBox,
              { borderColor: overdue && !shown ? colors.danger : colors.border },
            ]}
          >
            <View style={styles.clockTop}>
              <Ionicons
                name={overdue && !shown ? 'alert-circle' : 'time-outline'}
                size={15}
                color={overdue && !shown ? colors.danger : colors.mutedForeground}
              />
              <Text style={[text.bodySmall, { color: colors.mutedForeground, flex: 1 }]}>
                {shown
                  ? `Delivered inside the ${formatDuration(query.deadlineMinutes)} window.`
                  : overdue
                    ? `Nobody delivered inside the ${formatDuration(query.deadlineMinutes)} you allowed.`
                    : `You allowed ${formatDuration(query.deadlineMinutes)}.`}
              </Text>
              <Text
                style={[
                  text.dataMedium,
                  { color: overdue && !shown ? colors.danger : colors.foreground },
                ]}
              >
                {shown ? 'On time' : formatRemaining(msLeft)}
              </Text>
            </View>

            {/* The refund is offered only when it is genuinely owed. */}
            {overdue && !shown && (
              <>
                <Text style={[text.data, { color: colors.faintForeground }]}>
                  Take your ₦{formatNaira(query.bounty)} back, or leave it up and keep waiting.
                </Text>
                <View style={styles.clockActions}>
                  <Pressable
                    onPress={() => {
                      closeQuery(query.id);
                      router.replace('/(tabs)');
                    }}
                    style={({ pressed }) => [
                      styles.refundBtn,
                      { backgroundColor: colors.danger, opacity: pressed ? 0.88 : 1 },
                    ]}
                  >
                    <Text style={[text.action, { color: colors.background }]}>
                      Close · refund ₦{formatNaira(query.bounty)}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.replace('/(tabs)')}
                    style={({ pressed }) => [
                      styles.waitBtn,
                      { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Text style={[text.action, { color: colors.mutedForeground }]}>
                      Keep waiting
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        )}

        {/* ── Dispute ──────────────────────────────────────────────
            Both accounts, in order, so the asker can see exactly where it
            has got to and what the verifier said back. */}
        {dispute && (
          <View
            style={[
              styles.dispute,
              {
                borderColor:
                  dispute.status === 'resolved_verifier'
                    ? colors.primary
                    : dispute.status === 'resolved_asker'
                      ? colors.primary
                      : colors.pending,
              },
            ]}
          >
            <Text
              style={[
                text.label,
                {
                  color: dispute.status.startsWith('resolved')
                    ? colors.primary
                    : colors.pending,
                },
              ]}
            >
              {dispute.status === 'awaiting_verifier' && `Waiting on ${dispute.verifierName}`}
              {dispute.status === 'awaiting_admin' && 'With a reviewer'}
              {dispute.status === 'resolved_asker' && 'Query upheld'}
              {dispute.status === 'resolved_verifier' && 'Evidence stood'}
            </Text>

            <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 6 }]}>
              {dispute.status === 'awaiting_verifier' &&
                'They have been asked to answer your query. Your money stays held until this is settled.'}
              {dispute.status === 'awaiting_admin' &&
                'Both sides are in. A person is reading them along with the evidence.'}
              {dispute.status === 'resolved_asker' &&
                `The reviewer agreed with you. ₦${formatNaira(dispute.bounty)} has gone back to your wallet.`}
              {dispute.status === 'resolved_verifier' &&
                `The reviewer found the evidence held up, so ${dispute.verifierName} was paid.`}
            </Text>

            <View style={[styles.side, { borderColor: colors.border }]}>
              <Text style={[text.data, { color: colors.faintForeground }]}>You said</Text>
              <Text style={[text.bodySmall, { color: colors.foreground, marginTop: 3 }]}>
                {dispute.askerReason}
              </Text>
            </View>

            {dispute.verifierReply && (
              <View style={[styles.side, { borderColor: colors.border }]}>
                <Text style={[text.data, { color: colors.faintForeground }]}>
                  {dispute.verifierName} said
                </Text>
                <Text style={[text.bodySmall, { color: colors.foreground, marginTop: 3 }]}>
                  {dispute.verifierReply}
                </Text>
              </View>
            )}

            {dispute.adminNote && (
              <View style={[styles.side, { borderColor: colors.primary }]}>
                <Text style={[text.data, { color: colors.primary }]}>Reviewer</Text>
                <Text style={[text.bodySmall, { color: colors.foreground, marginTop: 3 }]}>
                  {dispute.adminNote}
                </Text>
              </View>
            )}
          </View>
        )}

        {shown && (
          <>
            <Text style={[text.label, { color: colors.faintForeground, marginTop: 32, marginBottom: 4 }]}>
              What came back
            </Text>
            <Text style={[text.bodySmall, { color: colors.mutedForeground, marginBottom: 14 }]}>
              Confirm it if it answers your question. Query it if it looks wrong.
            </Text>
            <VerificationCard
              verification={response}
              showActions={action === null}
              payout={verifierCut(query?.bounty ?? 0)}
              onConfirm={handleConfirm}
              onQuery={handleQuery}
            />
          </>
        )}

        {/* ── Leaving does not cancel anything ─────────────────────
            Watching a progress list is not work, and someone is walking
            somewhere either way. Say so plainly and offer the exit. */}
        {!showFinal && !(overdue && !shown) && (
          <View style={[styles.leaveBox, { borderColor: colors.border }]}>
            <View style={styles.leaveTop}>
              <Ionicons name="notifications-outline" size={15} color={colors.mutedForeground} />
              <Text style={[text.bodySmall, { color: colors.mutedForeground, flex: 1 }]}>
                {shown
                  ? 'Nothing expires while you are away. Pick this back up from Your questions on the Ask tab.'
                  : `This carries on without you. We will alert you the moment ${response.workerName} sends the evidence.`}
              </Text>
            </View>

            <Pressable
              onPress={() => router.replace('/(tabs)')}
              style={({ pressed }) => [
                styles.leaveBtn,
                { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="home-outline" size={15} color={colors.foreground} />
              <Text style={[text.action, { color: colors.foreground }]}>Close and wait</Text>
            </Pressable>
          </View>
        )}

        {/* ── Settled ──────────────────────────────────────────────── */}
        {showFinal && (
          <Animated.View style={{ opacity: fade }}>
            <View
              style={[
                styles.answer,
                { backgroundColor: colors.primarySoft, borderColor: colors.primary },
              ]}
            >
              <Text style={[text.label, { color: colors.primary }]}>Verified answer</Text>
              <Text style={[styles.answerText, { color: colors.foreground }]}>
                {response.response}
              </Text>
              <Text style={[text.bodySmall, { color: colors.mutedForeground }]}>
                {response.detail}
              </Text>
              <Text style={[text.bodySmall, { color: colors.mutedForeground }]}>
                You confirmed this as accurate, so {response.workerName} has been paid ₦
                {formatNaira(verifierCut(query?.bounty ?? 0))} of your ₦
                {formatNaira(query?.bounty ?? 0)} after the platform fee.
              </Text>
            </View>

            <Pressable
              onPress={() => router.replace('/(tabs)')}
              style={({ pressed }) => [
                styles.homeBtn,
                { backgroundColor: colors.foreground, opacity: pressed ? 0.88 : 1 },
              ]}
            >
              <Text style={[text.action, { color: colors.background }]}>Back to Ask</Text>
            </Pressable>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 44 },

  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  placeLine: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12 },
  steps: { marginTop: 26 },
  stepRow: { flexDirection: 'row', gap: 12 },
  stepGutter: { alignItems: 'center', width: 18 },
  stepMark: {
    width: 18,
    height: 18,
    borderRadius: 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepThread: { width: 1.5, flex: 1, minHeight: 12, marginVertical: 3 },
  stepBody: { flex: 1, paddingBottom: 18 },

  clockBox: { borderWidth: 2, borderRadius: 2, padding: 14, gap: 10, marginTop: 4 },
  clockTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  clockActions: { flexDirection: 'row', gap: 9 },
  refundBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 2,
    paddingVertical: 13,
  },
  waitBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },

  leaveBox: { borderWidth: 2, borderRadius: 2, padding: 14, gap: 12, marginTop: 12 },
  leaveTop: { flexDirection: 'row', gap: 9 },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 12,
  },

  dispute: { borderWidth: 2, borderRadius: 2, padding: 16, marginTop: 10 },
  side: { borderWidth: 2, borderRadius: 2, padding: 11, marginTop: 10 },

  answer: { borderWidth: 2, borderRadius: 2, padding: 20, gap: 8, marginTop: 8 },
  answerText: { fontFamily: font.sansBold, fontSize: 21, lineHeight: 27, letterSpacing: -0.1 },
  homeBtn: {
    borderRadius: 2,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
});
