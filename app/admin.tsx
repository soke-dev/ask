import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import { mediaUrl } from '@/utils/api';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import {
  deleteUser,
  deskLogin,
  endDeskSession,
  getActivity,
  getDisputes,
  getOverview,
  getIdentityChecks,
  getUsers,
  hasDeskSession,
  koboToNaira,
  resolveDispute,
  type ActivityRow,
  type AdminDispute,
  type AdminUser,
  type IdentityCheck,
  type Overview,
  decideIdentity,
} from '@/utils/adminApi';
import {
  connectWallet,
  currentAccount,
  fetchArbiter,
  onAccountChanged,
  shortAddress,
  walletAvailable,
} from '@/utils/adminWallet';

/**
 * The review desk.
 *
 * Everything here is read from the server, never from app state: this screen
 * exists to see what is actually in the database, so showing a local copy
 * would defeat the point. It is also the only screen that can delete an
 * account or move held money, which is why it sits behind its own password
 * rather than any signed-in user's session.
 */
type Tab = 'overview' | 'users' | 'identity' | 'activity' | 'disputes';

export default function AdminScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  const [unlocked, setUnlocked] = useState(hasDeskSession);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [checks, setChecks] = useState<IdentityCheck[]>([]);
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({});
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  /**
   * The reviewer's own wallet.
   *
   * Rulings are signed here rather than on the server, so the arbiter key stays
   * with the person doing the reviewing. The desk password gets you in to read;
   * moving money needs the wallet the contract names.
   */
  const [wallet, setWalletAddress] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Read from the contract, not from a build-time variable that can go stale
  // the moment the owner changes the arbiter.
  const [arbiterAddress, setArbiterAddress] = useState<string | null>(null);
  const isArbiter = Boolean(wallet) && Boolean(arbiterAddress) && wallet === arbiterAddress;

  useEffect(() => {
    void currentAccount().then(setWalletAddress);
    void fetchArbiter().then(setArbiterAddress);
    return onAccountChanged(setWalletAddress);
  }, []);

  async function connect() {
    setConnecting(true);
    setWalletError(null);
    const result = await connectWallet();
    setConnecting(false);
    if (!result.ok) {
      setWalletError(result.detail);
      return;
    }
    setWalletAddress(result.address);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [o, u, a, d, i] = await Promise.all([
      getOverview(),
      getUsers(search),
      getActivity(),
      getDisputes(),
      getIdentityChecks(),
    ]);
    if (o.ok) setOverview(o.data);
    if (u.ok) setUsers(u.data.users);
    if (a.ok) setActivity(a.data.activity);
    if (d.ok) setDisputes(d.data.disputes);
    if (i.ok) setChecks(i.data.checks);

    const failed = [o, u, a, d, i].find((r) => !r.ok);
    if (failed && !failed.ok) {
      setError(failed.detail);
      // A dropped session must return to the prompt, not sit on stale data.
      if (!hasDeskSession()) setUnlocked(false);
    }
    setLoading(false);
  }, [search]);

  useEffect(() => {
    if (unlocked) void load();
  }, [unlocked, load]);

  async function signIn() {
    if (password.length === 0 || signingIn) return;
    setSigningIn(true);
    setAuthError(null);
    const result = await deskLogin(password);
    setSigningIn(false);
    if (!result.ok) {
      setAuthError(result.detail);
      return;
    }
    setPassword('');
    setUnlocked(true);
  }

  function lock() {
    endDeskSession();
    setUnlocked(false);
    setOverview(null);
    setUsers([]);
    setActivity([]);
    setDisputes([]);
    setChecks([]);
  }

  async function decide(dispute: AdminDispute, winner: 'asker' | 'verifier') {
    const result = await resolveDispute(dispute.id, winner, notes[dispute.id] ?? '');
    if (!result.ok) {
      setError(result.detail);
      return;
    }
    setNotes((prev) => ({ ...prev, [dispute.id]: '' }));
    void load();
  }

  async function decideCheck(check: IdentityCheck, approve: boolean) {
    const name = nameEdits[check.id] ?? check.submittedName ?? '';
    const result = await decideIdentity(
      check.id,
      approve,
      name,
      approve ? '' : (nameEdits[`reason-${check.id}`] ?? ''),
    );
    if (!result.ok) {
      setError(result.detail);
      return;
    }
    setRejectFor(null);
    void load();
  }

  async function removeUser(id: string) {
    const result = await deleteUser(id);
    setConfirmDelete(null);
    if (!result.ok) {
      setError(result.detail);
      return;
    }
    void load();
  }

  // ── Locked ───────────────────────────────────────────────────────────────
  if (!unlocked) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <KeyboardAwareScrollViewCompat
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, { paddingTop: topPad }]}
        >
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { borderColor: colors.border }]}
          >
            <Ionicons name="arrow-back" size={18} color={colors.foreground} />
          </Pressable>

          <View style={[styles.lockBadge, { borderColor: colors.pending }]}>
            <Ionicons name="lock-closed-outline" size={22} color={colors.pending} />
          </View>

          <Text style={[text.display, { color: colors.foreground, marginTop: 16 }]}>
            Review desk
          </Text>
          <Text style={[text.body, { color: colors.mutedForeground, marginTop: 8 }]}>
            Staff only. This page can see every account and move money that is being held.
          </Text>

          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.faintForeground}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={signIn}
            style={[
              styles.field,
              {
                color: colors.foreground,
                backgroundColor: colors.surface,
                borderColor: authError ? colors.danger : colors.borderStrong,
              },
            ]}
          />

          {authError && (
            <Text style={[text.bodySmall, { color: colors.danger, marginTop: 8 }]}>
              {authError}
            </Text>
          )}

          <Pressable
            onPress={signIn}
            disabled={password.length === 0 || signingIn}
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: password.length > 0 ? colors.primary : colors.sunken,
                opacity: pressed ? 0.88 : 1,
              },
            ]}
          >
            <Text
              style={[
                text.action,
                {
                  color: password.length > 0 ? colors.primaryForeground : colors.faintForeground,
                },
              ]}
            >
              {signingIn ? 'Checking' : 'Unlock'}
            </Text>
          </Pressable>
        </KeyboardAwareScrollViewCompat>
      </View>
    );
  }

  // ── Unlocked ─────────────────────────────────────────────────────────────
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />
        }
        contentContainerStyle={[styles.scroll, { paddingTop: topPad }]}
      >
        <View style={styles.bar}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { borderColor: colors.border }]}
          >
            <Ionicons name="arrow-back" size={18} color={colors.foreground} />
          </Pressable>
          <Pressable onPress={lock} style={[styles.lockBtn, { borderColor: colors.border }]}>
            <Ionicons name="lock-closed-outline" size={13} color={colors.mutedForeground} />
            <Text style={[text.data, { color: colors.mutedForeground }]}>Lock</Text>
          </Pressable>
        </View>

        <Text style={[text.display, { color: colors.foreground, marginTop: 18 }]}>
          Review desk
        </Text>

        {/* The wallet, stated plainly. Reading the desk needs the password;
            moving money needs the address the contract names as arbiter. */}
        <View
          style={[
            styles.walletBar,
            { borderColor: wallet ? (isArbiter ? colors.primary : colors.pending) : colors.border },
          ]}
        >
          <Ionicons
            name={wallet ? (isArbiter ? 'shield-checkmark' : 'alert-circle') : 'wallet-outline'}
            size={16}
            color={wallet ? (isArbiter ? colors.primary : colors.pending) : colors.mutedForeground}
          />

          <View style={{ flex: 1 }}>
            {wallet ? (
              <>
                <Text style={[text.data, { color: colors.foreground }]}>
                  {shortAddress(wallet)}
                </Text>
                <Text
                  style={[
                    text.data,
                    { color: isArbiter ? colors.primary : colors.pending },
                  ]}
                >
                  {isArbiter
                    ? 'Arbiter · can settle disputes'
                    : arbiterAddress
                      ? 'Not the arbiter · rulings will be rejected'
                      : 'Arbiter address unknown · cannot check'}
                </Text>
              </>
            ) : (
              <Text style={[text.data, { color: colors.mutedForeground }]}>
                {walletAvailable()
                  ? 'No wallet connected'
                  : 'No wallet extension in this browser'}
              </Text>
            )}
          </View>

          {!wallet && walletAvailable() && (
            <Pressable
              onPress={connect}
              disabled={connecting}
              style={({ pressed }) => [
                styles.connectBtn,
                { backgroundColor: colors.foreground, opacity: pressed || connecting ? 0.8 : 1 },
              ]}
            >
              <Text style={[text.data, { color: colors.background }]}>
                {connecting ? 'Connecting' : 'Connect'}
              </Text>
            </Pressable>
          )}
        </View>

        {walletError && (
          <Text style={[text.bodySmall, { color: colors.danger, marginTop: 8 }]}>
            {walletError}
          </Text>
        )}

        {error && (
          <View style={[styles.errorRow, { borderColor: colors.danger }]}>
            <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
            <Text style={[text.bodySmall, { color: colors.danger, flex: 1 }]}>{error}</Text>
          </View>
        )}

        <View style={styles.tabs}>
          {(['overview', 'users', 'identity', 'activity', 'disputes'] as Tab[]).map((t) => {
            const active = tab === t;
            const badge =
              t === 'disputes'
                ? (overview?.disputes_to_decide ?? 0)
                : t === 'identity'
                  ? checks.filter((c) => c.status === 'pending').length
                  : 0;
            return (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                style={[
                  styles.tab,
                  {
                    borderColor: active ? colors.accent : colors.border,
                    backgroundColor: active ? colors.accent : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[
                    text.data,
                    { color: active ? colors.accentForeground : colors.mutedForeground },
                  ]}
                >
                  {t}
                  {badge > 0 ? ` ${badge}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading && !overview && (
          <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 40 }} />
        )}

        {tab === 'overview' && overview && (
          <View style={styles.grid}>
            {[
              { k: 'Accounts', v: String(overview.users) },
              { k: 'With a wallet', v: String(overview.with_wallet) },
              { k: 'Verified', v: String(overview.verified) },
              { k: 'Questions', v: String(overview.questions) },
              { k: 'Still open', v: String(overview.open_questions) },
              { k: 'Jobs taken', v: String(overview.tasks) },
              { k: 'To decide', v: String(overview.disputes_to_decide), tone: colors.pending },
              { k: 'Money held', v: `₦${koboToNaira(overview.held_kobo)}`, tone: colors.money },
            ].map((cell) => (
              <View key={cell.k} style={[styles.cell, { borderColor: colors.border }]}>
                <Text style={[text.amount, { color: cell.tone ?? colors.foreground }]}>
                  {cell.v}
                </Text>
                <Text style={[text.data, { color: colors.faintForeground }]}>{cell.k}</Text>
              </View>
            ))}
          </View>
        )}

        {tab === 'users' && (
          <>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search email or username"
              placeholderTextColor={colors.faintForeground}
              autoCapitalize="none"
              style={[
                styles.field,
                {
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            />
            {users.length === 0 && !loading && (
              <Text style={[text.bodySmall, styles.empty, { color: colors.mutedForeground }]}>
                No accounts yet. One appears the first time somebody signs in.
              </Text>
            )}
            {users.map((u) => (
              <View key={u.id} style={[styles.card, { borderColor: colors.border }]}>
                <View style={styles.rowBetween}>
                  <Text style={[text.heading, { color: colors.foreground, flex: 1 }]}>
                    {u.username ? `@${u.username}` : '(no username)'}
                  </Text>
                  {u.identityStatus === 'verified' && (
                    <Ionicons name="shield-checkmark" size={15} color={colors.primary} />
                  )}
                </View>
                <Text style={[text.data, { color: colors.mutedForeground }]}>
                  {u.email ?? '(no email)'}
                </Text>
                <Text style={[text.data, { color: colors.faintForeground }]}>
                  {u.walletAddress
                    ? `${u.walletAddress.slice(0, 10)}…${u.walletAddress.slice(-6)}`
                    : 'no wallet yet'}
                </Text>
                <Text style={[text.data, { color: colors.faintForeground }]}>
                  {u.questionsAsked} asked · {u.jobsTaken} jobs · joined{' '}
                  {new Date(u.createdAt).toLocaleDateString()}
                </Text>

                {confirmDelete === u.id ? (
                  <View style={styles.confirmRow}>
                    <Pressable
                      onPress={() => removeUser(u.id)}
                      style={[styles.smallBtn, { backgroundColor: colors.danger }]}
                    >
                      <Text style={[text.data, { color: colors.background }]}>
                        Delete for good
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setConfirmDelete(null)}
                      style={[styles.smallBtn, { borderWidth: 2, borderColor: colors.border }]}
                    >
                      <Text style={[text.data, { color: colors.mutedForeground }]}>Cancel</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => setConfirmDelete(u.id)} style={styles.deleteLink}>
                    <Ionicons name="trash-outline" size={13} color={colors.danger} />
                    <Text style={[text.data, { color: colors.danger }]}>Delete account</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </>
        )}

        {tab === 'identity' && (
          <>
            {checks.length === 0 && !loading && (
              <Text style={[text.bodySmall, styles.empty, { color: colors.mutedForeground }]}>
                Nothing to review. A check appears here when somebody submits a NIN.
              </Text>
            )}
            {checks.map((c) => {
              const pending = c.status === 'pending';
              return (
                <View
                  key={c.id}
                  style={[
                    styles.card,
                    { borderColor: pending ? colors.pending : colors.border },
                  ]}
                >
                  <Text
                    style={[
                      text.label,
                      {
                        color: pending
                          ? colors.pending
                          : c.status === 'verified'
                            ? colors.primary
                            : colors.danger,
                      },
                    ]}
                  >
                    {pending
                      ? 'Waiting on you'
                      : c.status === 'verified'
                        ? 'Approved'
                        : 'Rejected'}
                  </Text>

                  <Text style={[text.heading, { color: colors.foreground, marginTop: 4 }]}>
                    {c.username ? `@${c.username}` : (c.email ?? 'unknown')}
                  </Text>

                  {/* The two things a reviewer compares. Shown together and
                      nowhere else in the app. */}
                  <View style={[styles.side, { borderColor: colors.border }]}>
                    <Text style={[text.data, { color: colors.faintForeground }]}>
                      Name claimed
                    </Text>
                    <Text style={[text.body, { color: colors.foreground }]}>
                      {c.submittedName ?? '—'}
                    </Text>
                    <Text style={[text.data, { color: colors.faintForeground, marginTop: 8 }]}>
                      NIN
                    </Text>
                    <Text style={[styles.ninText, { color: colors.foreground }]} selectable>
                      {c.nin ?? '—'}
                    </Text>
                  </View>

                  {c.status === 'verified' && c.verifiedName && (
                    <Text style={[text.bodySmall, { color: colors.mutedForeground }]}>
                      Recorded as {c.verifiedName}
                    </Text>
                  )}
                  {c.status === 'rejected' && c.rejectionReason && (
                    <Text style={[text.bodySmall, { color: colors.mutedForeground }]}>
                      Reason: {c.rejectionReason}
                    </Text>
                  )}

                  {pending && rejectFor !== c.id && (
                    <>
                      {/* Approving asserts this name, so it is editable — the
                          NIMC record is what counts, not what was typed. */}
                      <Text style={[text.data, { color: colors.faintForeground, marginTop: 4 }]}>
                        Name to record
                      </Text>
                      <TextInput
                        value={nameEdits[c.id] ?? c.submittedName ?? ''}
                        onChangeText={(v) => setNameEdits((p) => ({ ...p, [c.id]: v }))}
                        placeholder="Name exactly as on the NIN record"
                        placeholderTextColor={colors.faintForeground}
                        style={[
                          styles.noteField,
                          {
                            color: colors.foreground,
                            backgroundColor: colors.surface,
                            borderColor: colors.borderStrong,
                            minHeight: 0,
                          },
                        ]}
                      />
                      <View style={styles.decideRow}>
                        <Pressable
                          onPress={() => decideCheck(c, true)}
                          style={[styles.decide, { backgroundColor: colors.primary }]}
                        >
                          <Text style={[text.action, { color: colors.primaryForeground }]}>
                            Approve
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setRejectFor(c.id)}
                          style={[styles.decide, { backgroundColor: colors.danger }]}
                        >
                          <Text style={[text.action, { color: colors.background }]}>Reject</Text>
                        </Pressable>
                      </View>
                    </>
                  )}

                  {pending && rejectFor === c.id && (
                    <>
                      <TextInput
                        value={nameEdits[`reason-${c.id}`] ?? ''}
                        onChangeText={(v) =>
                          setNameEdits((p) => ({ ...p, [`reason-${c.id}`]: v }))
                        }
                        placeholder="Why — they see this and can fix it"
                        placeholderTextColor={colors.faintForeground}
                        multiline
                        style={[
                          styles.noteField,
                          {
                            color: colors.foreground,
                            backgroundColor: colors.surface,
                            borderColor: colors.danger,
                          },
                        ]}
                      />
                      <View style={styles.decideRow}>
                        <Pressable
                          onPress={() => decideCheck(c, false)}
                          style={[styles.decide, { backgroundColor: colors.danger }]}
                        >
                          <Text style={[text.action, { color: colors.background }]}>
                            Confirm reject
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setRejectFor(null)}
                          style={[
                            styles.decide,
                            { borderWidth: 2, borderColor: colors.border },
                          ]}
                        >
                          <Text style={[text.action, { color: colors.mutedForeground }]}>
                            Cancel
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
              );
            })}
          </>
        )}

        {tab === 'activity' && (
          <>
            {activity.length === 0 && !loading && (
              <Text style={[text.bodySmall, styles.empty, { color: colors.mutedForeground }]}>
                Nothing has happened yet.
              </Text>
            )}
            {activity.map((row) => (
              <View
                key={`${row.kind}-${row.id}`}
                style={[styles.feedRow, { borderBottomColor: colors.border }]}
              >
                <View
                  style={[
                    styles.kindTag,
                    {
                      borderColor:
                        row.kind === 'dispute'
                          ? colors.danger
                          : row.kind === 'money'
                            ? colors.money
                            : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      text.data,
                      {
                        color:
                          row.kind === 'dispute'
                            ? colors.danger
                            : row.kind === 'money'
                              ? colors.money
                              : colors.mutedForeground,
                      },
                    ]}
                  >
                    {row.kind}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[text.bodySmall, { color: colors.foreground }]} numberOfLines={2}>
                    {row.detail ?? '—'}
                  </Text>
                  <Text style={[text.data, { color: colors.faintForeground }]}>
                    {row.who ? `@${row.who} · ` : ''}
                    {new Date(row.at).toLocaleString()}
                    {row.amount_kobo ? ` · ₦${koboToNaira(row.amount_kobo)}` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}

        {tab === 'disputes' && (
          <>
            {disputes.length === 0 && !loading && (
              <Text style={[text.bodySmall, styles.empty, { color: colors.mutedForeground }]}>
                No disputes. One arrives when an asker queries an answer.
              </Text>
            )}
            {disputes.map((d) => {
              /**
               * Decidable from the moment it exists, not only once the
               * verifier has replied.
               *
               * This waited for 'awaiting_admin', so a verifier who simply
               * never answered left the money held forever and the desk with
               * no button to end it. The reply is useful, not required — a
               * reviewer can already see the evidence and the objection, and
               * somebody has to be able to end a stalemate.
               */
              const undecided = !d.status.startsWith('resolved');

              /**
               * Deciding moves money on chain, so the arbiter wallet has to be
               * connected first.
               *
               * Without this the desk offered Pay verifier and Refund on a
               * reviewer who had connected nothing — the database would record
               * a decision the contract could never carry out, and the two
               * would disagree about who held the bounty with no way back.
               */
              const ready = undecided && isArbiter;
              const decided = d.status.startsWith('resolved');
              return (
                <View
                  key={d.id}
                  style={[
                    styles.card,
                    { borderColor: ready ? colors.pending : colors.border },
                  ]}
                >
                  <Text
                    style={[
                      text.label,
                      { color: ready ? colors.pending : colors.faintForeground },
                    ]}
                  >
                    {ready
                      ? 'Ready to decide'
                      : decided
                        ? d.status === 'resolved_asker'
                          ? 'Refunded the asker'
                          : 'Paid the verifier'
                        : `Waiting on @${d.verifierName ?? 'verifier'}`}
                  </Text>
                  <Text style={[text.heading, { color: colors.foreground, marginTop: 4 }]}>
                    {d.question}
                  </Text>
                  <Text style={[text.data, { color: colors.faintForeground }]}>
                    {d.placeName ?? 'unknown place'} · ₦{koboToNaira(d.bountyKobo)} held
                    {d.evidenceKind ? ` · ${d.evidenceKind}` : ''}
                    {d.distanceMetres !== null ? ` · ${d.distanceMetres}m away` : ''}
                  </Text>

                  <View style={[styles.side, { borderColor: colors.danger }]}>
                    <Text style={[text.data, { color: colors.danger }]}>
                      @{d.askerName ?? 'asker'} · asker
                    </Text>
                    <Text style={[text.bodySmall, { color: colors.foreground, marginTop: 3 }]}>
                      {d.askerReason}
                    </Text>
                  </View>

                  {/* The evidence itself, whatever stage this is at. A
                      reviewer asked to judge a photo they cannot see is being
                      asked to take the objection on trust. */}
                  {d.evidenceUrl && (
                    <View style={[styles.side, { borderColor: colors.borderStrong }]}>
                      <Text style={[text.data, { color: colors.faintForeground }]}>
                        evidence · {d.evidenceKind ?? 'file'}
                        {d.capturedAt ? ` · ${new Date(d.capturedAt).toLocaleString()}` : ''}
                      </Text>
                      {d.evidenceKind === 'video' ? (
                        <Text
                          onPress={() => {
                            const url = mediaUrl(d.evidenceUrl);
                            if (url) void Linking.openURL(url);
                          }}
                          style={[text.action, { color: colors.accent, marginTop: 6 }]}
                        >
                          Open the video
                        </Text>
                      ) : (
                        <Image
                          source={{ uri: mediaUrl(d.evidenceUrl) ?? undefined }}
                          style={styles.evidenceShot}
                          resizeMode="cover"
                        />
                      )}
                      {d.answer && (
                        <Text style={[text.bodySmall, { color: colors.foreground, marginTop: 8 }]}>
                          “{d.answer}”
                        </Text>
                      )}
                    </View>
                  )}

                  {d.verifierReply && (
                    <View style={[styles.side, { borderColor: colors.primary }]}>
                      <Text style={[text.data, { color: colors.primary }]}>
                        @{d.verifierName ?? 'verifier'} · verifier
                      </Text>
                      <Text style={[text.bodySmall, { color: colors.foreground, marginTop: 3 }]}>
                        {d.verifierReply}
                      </Text>
                    </View>
                  )}

                  {d.adminNote && (
                    <Text style={[text.bodySmall, { color: colors.mutedForeground }]}>
                      Reviewer: {d.adminNote}
                    </Text>
                  )}

                  {undecided && !isArbiter && (
                    <View style={[styles.side, { borderColor: colors.pending }]}>
                      <Text style={[text.data, { color: colors.pending }]}>
                        {wallet
                          ? 'that wallet is not the arbiter'
                          : 'connect the arbiter wallet to decide'}
                      </Text>
                      <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 3 }]}>
                        {wallet
                          ? 'The contract only accepts the arbiter address. Switch accounts and reconnect.'
                          : 'A decision releases the bounty on chain, so it has to be signed by the arbiter.'}
                      </Text>
                    </View>
                  )}

                  {ready && (
                    <>
                      <TextInput
                        value={notes[d.id] ?? ''}
                        onChangeText={(v) => setNotes((p) => ({ ...p, [d.id]: v }))}
                        placeholder="Reason for the decision — both sides see this"
                        placeholderTextColor={colors.faintForeground}
                        multiline
                        style={[
                          styles.noteField,
                          {
                            color: colors.foreground,
                            backgroundColor: colors.surface,
                            borderColor: colors.borderStrong,
                          },
                        ]}
                      />
                      <View style={styles.decideRow}>
                        <Pressable
                          onPress={() => decide(d, 'verifier')}
                          style={[styles.decide, { backgroundColor: colors.primary }]}
                        >
                          <Text style={[text.action, { color: colors.primaryForeground }]}>
                            Pay verifier
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => decide(d, 'asker')}
                          style={[styles.decide, { backgroundColor: colors.danger }]}
                        >
                          <Text style={[text.action, { color: colors.background }]}>
                            Refund ₦{koboToNaira(d.bountyKobo)}
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
              );
            })}
          </>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  // Big enough to judge, not so big the queue becomes a gallery.
  // Taller on the desk than it would be on a phone: this is the picture the
  // whole decision turns on, and 190px was a thumbnail.
  evidenceShot: { width: '100%', height: 420, borderRadius: 2, marginTop: 8 },
  screen: { flex: 1 },
  /**
   * Centred and capped rather than edge to edge.
   *
   * Unframing the route hands the desk the whole browser window, and a line of
   * text running the width of a 27" monitor is unreadable. 1100 is wide enough
   * for the evidence to be judged at a useful size and for the objection to
   * sit beside it, and narrow enough to still be a column.
   */
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 44,
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
  },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  lockBadge: {
    width: 46,
    height: 46,
    borderWidth: 2,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 26,
  },
  field: {
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 18,
    fontFamily: font.sans,
    fontSize: 16,
  },
  primaryBtn: { borderRadius: 2, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  tabs: { flexDirection: 'row', gap: 7, marginTop: 18, flexWrap: 'wrap' },
  tab: { borderWidth: 2, borderRadius: 2, paddingHorizontal: 11, paddingVertical: 7 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 18 },
  cell: {
    borderWidth: 2,
    borderRadius: 2,
    padding: 13,
    gap: 3,
    flexGrow: 1,
    flexBasis: '46%',
  },
  card: { borderWidth: 2, borderRadius: 2, padding: 14, gap: 6, marginTop: 14 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  side: { borderWidth: 2, borderRadius: 2, padding: 11, marginTop: 4 },
  noteField: {
    borderWidth: 2,
    borderRadius: 2,
    padding: 12,
    minHeight: 68,
    textAlignVertical: 'top',
    fontFamily: font.sans,
    fontSize: 15,
    marginTop: 6,
  },
  decideRow: { flexDirection: 'row', gap: 9, marginTop: 6 },
  decide: { flex: 1, borderRadius: 2, paddingVertical: 13, alignItems: 'center' },
  feedRow: { flexDirection: 'row', gap: 11, paddingVertical: 13, borderBottomWidth: 1 },
  kindTag: { borderWidth: 2, borderRadius: 2, paddingHorizontal: 7, paddingVertical: 3 },
  deleteLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  confirmRow: { flexDirection: 'row', gap: 9, marginTop: 6 },
  smallBtn: { borderRadius: 2, paddingHorizontal: 12, paddingVertical: 9 },
  walletBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 2,
    borderRadius: 2,
    padding: 12,
    marginTop: 16,
  },
  connectBtn: { borderRadius: 2, paddingHorizontal: 13, paddingVertical: 8 },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderWidth: 2,
    borderRadius: 2,
    padding: 11,
    marginTop: 14,
  },
  empty: { marginTop: 40, textAlign: 'center' },
  ninText: { fontFamily: font.mono, fontSize: 16, letterSpacing: 1 },
});
