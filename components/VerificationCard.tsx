import React, { useState } from 'react';
import {
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
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import { formatNaira } from '@/constants/money';

export type Verification = {
  workerInitials: string;
  workerName: string;
  response: string;
  detail: string;
  timeAgo: string;
  distance: string;
  mediaType?: 'photo' | 'video';
  status?: 'pending' | 'confirmed' | 'queried';
  /** Identity confirmed. */
  idVerified?: boolean;
  jobsDone?: number;
  /** Clock time the capture was taken, for judging how fresh it is. */
  capturedAt?: string;
  /** Where the device was when it captured, not where the job was posted. */
  capturedNear?: string;
  /** Video only. */
  duration?: string;
  /**
   * What the automatic gate found before this reached the asker.
   *
   * Carried through rather than summarised so the asker sees the same words
   * the verifier saw. A `skipped` entry is kept deliberately: "we could not
   * check this" is information the asker should have when deciding whether to
   * confirm, and hiding it would leave the card implying a clean check.
   */
  checks?: { name: string; verdict: 'pass' | 'warn' | 'fail' | 'skipped'; detail: string }[];
};

type Props = {
  verification: Verification;
  onConfirm?: () => void;
  /** Receives the reason. An unexplained objection is not reviewable. */
  onQuery?: (reason: string) => void;
  showActions?: boolean;
  /** What the verifier receives, so the warning can name the real figure. */
  payout?: number;
};

/**
 * The evidence itself, standing in for the real capture.
 *
 * NOTE: no camera is wired up yet, so this renders a placeholder frame rather
 * than a photo or video. Everything around it — the capture time, the place
 * the device was standing, the proof type — is what makes evidence checkable,
 * so it is laid out now and only the frame needs swapping for real media.
 */
function EvidenceFrame({
  verification,
  large = false,
}: {
  verification: Verification;
  large?: boolean;
}) {
  const colors = useColors();
  const isVideo = verification.mediaType === 'video';

  return (
    <View
      style={[
        styles.frame,
        large ? styles.frameLarge : styles.frameSmall,
        { backgroundColor: colors.sunken, borderColor: colors.border },
      ]}
    >
      {[0.25, 0.5, 0.75].map((f) => (
        <View
          key={`h${f}`}
          style={[styles.frameRule, { top: `${f * 100}%`, backgroundColor: colors.border }]}
        />
      ))}
      {[0.33, 0.66].map((f) => (
        <View
          key={`v${f}`}
          style={[styles.frameRuleV, { left: `${f * 100}%`, backgroundColor: colors.border }]}
        />
      ))}

      <View style={[styles.frameGlyph, { borderColor: colors.borderStrong }]}>
        <Ionicons
          name={isVideo ? 'play' : 'camera'}
          size={large ? 26 : 18}
          color={colors.foreground}
        />
      </View>

      <View style={[styles.frameTag, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <Text style={[text.data, { color: colors.foreground }]}>
          {isVideo ? `Video · ${verification.duration ?? '0:12'}` : 'Photo'}
        </Text>
      </View>
    </View>
  );
}

export function VerificationCard({
  verification,
  onConfirm,
  onQuery,
  showActions,
  payout,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [viewerOpen, setViewerOpen] = useState(false);

  // Confirming moves money and cannot be taken back, so it is never the
  // direct result of one tap.
  const [confirmOpen, setConfirmOpen] = useState(false);

  // A reason is collected before the objection is filed, because the verifier
  // has to answer something specific and an admin has to judge between two
  // accounts. "It is wrong" gives neither of them anything to work with.
  const [queryOpen, setQueryOpen] = useState(false);
  const [reason, setReason] = useState('');
  const reasonValid = reason.trim().length >= 10;

  function askToConfirm() {
    setViewerOpen(false);
    setConfirmOpen(true);
  }

  function askToQuery() {
    setViewerOpen(false);
    setQueryOpen(true);
  }

  const isConfirmed = verification.status === 'confirmed';
  const isQueried = verification.status === 'queried';
  const isPending = !isConfirmed && !isQueried;

  const edge = isConfirmed ? colors.primary : isQueried ? colors.pending : colors.border;

  const checks = verification.checks ?? [];
  const notable = checks.filter((c) => c.verdict !== 'pass');
  const allClear = checks.length > 0 && notable.length === 0;

  const facts = [
    { k: 'Captured', v: verification.capturedAt ?? verification.timeAgo },
    { k: 'Device was', v: verification.capturedNear ?? verification.distance },
    { k: 'Proof', v: verification.mediaType === 'video' ? 'Video' : 'Photo' },
    { k: 'Verifier', v: `${verification.workerName}${verification.idVerified ? ' · ID verified' : ''}` },
  ];

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: edge, borderWidth: isPending ? 1 : 2 },
      ]}
    >
      <View style={styles.head}>
        <View style={[styles.avatar, { backgroundColor: colors.sunken }]}>
          <Text style={[styles.initials, { color: colors.foreground }]}>
            {verification.workerInitials}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          {/* First name, badge and record — enough to judge whether to trust
              the answer. Deliberately no phone number: there is nothing to
              coordinate, and a number only creates a way to be defrauded. */}
          <View style={styles.nameRow}>
            <Text style={[text.subheading, { color: colors.foreground }]}>
              {verification.workerName}
            </Text>
            {verification.idVerified && (
              <Ionicons name="shield-checkmark" size={13} color={colors.primary} />
            )}
          </View>
          <Text style={[text.data, { color: colors.faintForeground }]}>
            {verification.distance} · {verification.timeAgo}
            {verification.jobsDone ? ` · ${verification.jobsDone} jobs` : ''}
          </Text>
        </View>
      </View>

      {/* The answer itself is the loudest thing in the card */}
      <Text style={[styles.response, { color: colors.foreground }]}>{verification.response}</Text>
      <Text style={[text.bodySmall, { color: colors.mutedForeground }]}>
        {verification.detail}
      </Text>

      {/* ── The proof, before any decision is asked for ─────────────── */}
      {verification.mediaType && (
        <Pressable
          onPress={() => setViewerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Open the ${verification.mediaType} evidence full screen`}
          style={({ pressed }) => [styles.evidenceBtn, { opacity: pressed ? 0.8 : 1 }]}
        >
          <EvidenceFrame verification={verification} />
          <View style={styles.evidenceFoot}>
            <Ionicons name="expand-outline" size={13} color={colors.mutedForeground} />
            <Text style={[text.data, { color: colors.mutedForeground, flex: 1 }]}>
              Tap to see it full size and check the details
            </Text>
          </View>
        </Pressable>
      )}

      {/* ── What the check found ────────────────────────────────────
          Only the things worth reading: a wall of green ticks trains people
          to skip the block entirely, and then the one warning that mattered
          gets skipped with it. */}
      {notable.length > 0 && (
        <View style={[styles.checkBlock, { borderColor: colors.border }]}>
          <Text style={[text.data, { color: colors.faintForeground }]}>Automatic check</Text>
          {notable.map((check) => (
            <View key={check.name} style={styles.checkLine}>
              <Ionicons
                name={
                  check.verdict === 'fail'
                    ? 'close-circle'
                    : check.verdict === 'warn'
                      ? 'alert-circle'
                      : 'remove-circle-outline'
                }
                size={14}
                color={
                  check.verdict === 'fail'
                    ? colors.danger
                    : check.verdict === 'warn'
                      ? colors.pending
                      : colors.faintForeground
                }
              />
              <Text style={[text.data, { color: colors.mutedForeground, flex: 1 }]}>
                {check.detail}
              </Text>
            </View>
          ))}
        </View>
      )}

      {allClear && (
        <View style={styles.checkLine}>
          <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
          <Text style={[text.data, { color: colors.mutedForeground, flex: 1 }]}>
            Passed every automatic check.
          </Text>
        </View>
      )}

      {(isConfirmed || isQueried) && (
        <View style={styles.statusRow}>
          <Ionicons
            name={isConfirmed ? 'checkmark-circle' : 'help-circle'}
            size={15}
            color={isConfirmed ? colors.primary : colors.pending}
          />
          <Text
            style={[text.dataMedium, { color: isConfirmed ? colors.primary : colors.pending }]}
          >
            {isConfirmed ? 'You confirmed this · verifier paid' : 'You queried this · under review'}
          </Text>
        </View>
      )}

      {showActions && isPending && (
        <View style={styles.actions}>
          <Pressable
            onPress={askToConfirm}
            style={({ pressed }) => [
              styles.confirmBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
            ]}
          >
            <Ionicons name="checkmark" size={16} color={colors.primaryForeground} />
            <Text style={[text.action, { color: colors.primaryForeground }]}>
              That answers it
            </Text>
          </Pressable>
          <Pressable
            onPress={askToQuery}
            style={({ pressed }) => [
              styles.queryBtn,
              { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[text.action, { color: colors.mutedForeground }]}>Query</Text>
          </Pressable>
        </View>
      )}

      {/* ── Raising a query ─────────────────────────────────────────── */}
      <Modal
        visible={queryOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setQueryOpen(false)}
      >
        <Pressable
          style={[styles.confirmBackdrop, { backgroundColor: colors.overlay }]}
          onPress={() => setQueryOpen(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.confirmSheet,
              { backgroundColor: colors.background, borderColor: colors.pending },
            ]}
          >
            <Text style={[text.label, { color: colors.pending }]}>Raising a query</Text>
            <Text style={[styles.confirmTitle, { color: colors.foreground }]}>
              What is wrong with it?
            </Text>

            <Text style={[text.body, { color: colors.mutedForeground }]}>
              {verification.workerName} gets to answer this, and a person reads both sides before
              deciding. Be specific about what does not match.
            </Text>

            <TextInput
              style={[
                styles.reasonField,
                {
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  borderColor: colors.borderStrong,
                },
              ]}
              value={reason}
              onChangeText={setReason}
              placeholder="The video shows a different station, not the one on Airport Road…"
              placeholderTextColor={colors.faintForeground}
              multiline
            />

            <Text
              style={[
                text.data,
                { color: reasonValid ? colors.faintForeground : colors.pending },
              ]}
            >
              {reasonValid
                ? 'Your money stays held until this is settled.'
                : 'Say a little more — at least a sentence.'}
            </Text>

            <Pressable
              onPress={() => {
                if (!reasonValid) return;
                setQueryOpen(false);
                onQuery?.(reason.trim());
                setReason('');
              }}
              disabled={!reasonValid}
              style={({ pressed }) => [
                styles.confirmGo,
                {
                  backgroundColor: reasonValid ? colors.pending : colors.sunken,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}
            >
              <Text
                style={[
                  text.action,
                  { color: reasonValid ? colors.background : colors.faintForeground },
                ]}
              >
                Send the query
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setQueryOpen(false)}
              style={({ pressed }) => [
                styles.confirmCancel,
                { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[text.action, { color: colors.mutedForeground }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Releasing the money ─────────────────────────────────────── */}
      <Modal
        visible={confirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmOpen(false)}
      >
        <Pressable
          style={[styles.confirmBackdrop, { backgroundColor: colors.overlay }]}
          onPress={() => setConfirmOpen(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.confirmSheet,
              { backgroundColor: colors.background, borderColor: colors.primary },
            ]}
          >
            <Text style={[text.label, { color: colors.primary }]}>Releasing payment</Text>
            <Text style={[styles.confirmTitle, { color: colors.foreground }]}>
              Pay {verification.workerName}
              {payout ? ` ₦${formatNaira(payout)}` : ''}?
            </Text>

            <Text style={[text.body, { color: colors.mutedForeground }]}>
              {payout ? `₦${formatNaira(payout)} goes` : 'The money goes'} to{' '}
              {verification.workerName} the moment you confirm.{' '}
              <Text style={{ color: colors.foreground, fontFamily: font.sansSemi }}>
                This cannot be reversed.
              </Text>
            </Text>

            <View style={[styles.confirmNote, { borderColor: colors.border }]}>
              <Ionicons name="help-circle-outline" size={15} color={colors.pending} />
              <Text style={[text.bodySmall, { color: colors.mutedForeground, flex: 1 }]}>
                If the answer is wrong or incomplete, close this and use Query instead. A person
                reviews it before any money moves.
              </Text>
            </View>

            <Pressable
              onPress={() => {
                setConfirmOpen(false);
                onConfirm?.();
              }}
              style={({ pressed }) => [
                styles.confirmGo,
                { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
              ]}
            >
              <Ionicons name="lock-open" size={15} color={colors.primaryForeground} />
              <Text style={[text.action, { color: colors.primaryForeground }]}>
                {payout ? `Release ₦${formatNaira(payout)}` : 'Release payment'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setConfirmOpen(false)}
              style={({ pressed }) => [
                styles.confirmCancel,
                { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[text.action, { color: colors.mutedForeground }]}>Not yet</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Full-size viewer ────────────────────────────────────────── */}
      <Modal
        visible={viewerOpen}
        animationType="slide"
        onRequestClose={() => setViewerOpen(false)}
        transparent={false}
      >
        <View style={[styles.viewer, { backgroundColor: colors.background }]}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.viewerScroll,
              {
                paddingTop: (Platform.OS === 'web' ? 20 : insets.top) + 14,
                paddingBottom: (Platform.OS === 'web' ? 24 : insets.bottom) + 24,
              },
            ]}
          >
            <View style={styles.viewerBar}>
              <Text style={[text.label, { color: colors.faintForeground, flex: 1 }]}>
                The evidence
              </Text>
              <Pressable
                onPress={() => setViewerOpen(false)}
                hitSlop={10}
                style={[styles.closeBtn, { borderColor: colors.border }]}
              >
                <Ionicons name="close" size={18} color={colors.foreground} />
              </Pressable>
            </View>

            <EvidenceFrame verification={verification} large />

            <Text style={[styles.viewerAnswer, { color: colors.foreground }]}>
              {verification.response}
            </Text>
            <Text style={[text.body, { color: colors.mutedForeground }]}>
              {verification.detail}
            </Text>

            <View style={[styles.factTable, { borderColor: colors.border }]}>
              {facts.map((f, i) => (
                <View
                  key={f.k}
                  style={[
                    styles.factRow,
                    i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                  ]}
                >
                  <Text style={[text.bodySmall, { color: colors.mutedForeground, flex: 1 }]}>
                    {f.k}
                  </Text>
                  <Text
                    style={[text.dataMedium, { color: colors.foreground, flex: 1.4, textAlign: 'right' }]}
                  >
                    {f.v}
                  </Text>
                </View>
              ))}
            </View>

            {showActions && isPending && (
              <View style={styles.viewerActions}>
                <Pressable
                  onPress={askToConfirm}
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
                  ]}
                >
                  <Ionicons name="checkmark" size={16} color={colors.primaryForeground} />
                  <Text style={[text.action, { color: colors.primaryForeground }]}>
                    That answers it
                  </Text>
                </Pressable>
                <Pressable
                  onPress={askToQuery}
                  style={({ pressed }) => [
                    styles.queryBtn,
                    { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[text.action, { color: colors.mutedForeground }]}>Query</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 2, padding: 16, marginBottom: 12, gap: 9 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontFamily: font.monoMedium, fontSize: 13 },
  response: { fontFamily: font.sansSemi, fontSize: 17.5, lineHeight: 24, marginTop: 2 },

  evidenceBtn: { marginTop: 4, gap: 7 },
  evidenceFoot: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  frame: {
    borderWidth: 2,
    borderRadius: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameSmall: { height: 150 },
  frameLarge: { height: 260, marginTop: 14 },
  frameRule: { position: 'absolute', left: 0, right: 0, height: 1, opacity: 0.6 },
  frameRuleV: { position: 'absolute', top: 0, bottom: 0, width: 1, opacity: 0.6 },
  frameGlyph: {
    width: 52,
    height: 52,
    borderRadius: 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameTag: {
    position: 'absolute',
    bottom: 9,
    left: 9,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  checkBlock: { borderWidth: 1, borderRadius: 2, padding: 11, gap: 7, marginTop: 12 },
  checkLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 9, marginTop: 6 },
  confirmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 2,
    paddingVertical: 13,
  },
  queryBtn: {
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 13,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },

  confirmBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  confirmSheet: {
    width: '100%',
    maxWidth: 380,
    borderWidth: 2,
    borderRadius: 2,
    padding: 20,
    gap: 12,
  },
  confirmTitle: { fontFamily: font.sansBold, fontSize: 23, lineHeight: 28, marginTop: -2 },
  reasonField: {
    borderWidth: 2,
    borderRadius: 2,
    padding: 12,
    minHeight: 92,
    textAlignVertical: 'top',
    fontFamily: font.sans,
    fontSize: 15,
  },
  confirmNote: {
    flexDirection: 'row',
    gap: 9,
    borderWidth: 2,
    borderRadius: 2,
    padding: 12,
  },
  confirmGo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 2,
    paddingVertical: 15,
    marginTop: 2,
  },
  confirmCancel: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 14,
  },

  viewer: { flex: 1 },
  viewerScroll: { paddingHorizontal: 20 },
  viewerBar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerAnswer: {
    fontFamily: font.sansBold,
    fontSize: 22,
    lineHeight: 28,
    marginTop: 20,
    marginBottom: 6,
  },
  factTable: { borderWidth: 2, borderRadius: 2, marginTop: 20 },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  viewerActions: { flexDirection: 'row', gap: 9, marginTop: 24 },
});
