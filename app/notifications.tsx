import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import { useApp, type AppNotification, type NotificationKind } from '@/contexts/AppContext';

/**
 * Each kind gets a fixed colour and a short code, the way a board labels a
 * service. Colour is never decorative here: green is money, orange is
 * something waiting on you, amber is under review.
 */
const KIND: Record<
  NotificationKind,
  { code: string; icon: keyof typeof Ionicons.glyphMap; tone: 'primary' | 'accent' | 'pending' | 'info' }
> = {
  job: { code: 'Job', icon: 'walk', tone: 'primary' },
  answer: { code: 'Answer', icon: 'chatbox-ellipses', tone: 'accent' },
  payment: { code: 'Paid', icon: 'cash', tone: 'primary' },
  identity: { code: 'ID', icon: 'shield-checkmark', tone: 'info' },
  dispute: { code: 'Review', icon: 'alert-circle', tone: 'pending' },
};

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { notifications, unreadCount, markNotificationRead, markAllNotificationsRead } = useApp();

  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;
  const today = notifications.filter((n) => n.today);
  const earlier = notifications.filter((n) => !n.today);

  const toneOf = (kind: NotificationKind) => {
    const tone = KIND[kind].tone;
    return tone === 'primary'
      ? colors.primary
      : tone === 'accent'
        ? colors.accent
        : tone === 'pending'
          ? colors.pending
          : colors.info;
  };

  function open(item: AppNotification) {
    markNotificationRead(item.id);
    // Jobs live on Earn; money and identity live on You. Answers would deep
    // link to their tracking screen once questions are persisted server-side.
    if (item.kind === 'job') router.push('/(tabs)/earn');
    else if (item.kind === 'payment' || item.kind === 'identity') router.push('/(tabs)/you');
  }

  function renderRow(item: AppNotification) {
    const tone = toneOf(item.kind);
    return (
      <Pressable
        key={item.id}
        onPress={() => open(item)}
        style={({ pressed }) => [
          styles.row,
          {
            borderColor: colors.border,
            backgroundColor: pressed
              ? colors.sunken
              : item.read
                ? 'transparent'
                : colors.surface,
          },
        ]}
      >
        {/* Unread carries a lit rail; read rows sit flush and quiet. */}
        <View style={[styles.rail, { backgroundColor: item.read ? 'transparent' : tone }]} />

        <View style={styles.rowBody}>
          <View style={styles.rowHead}>
            <Ionicons name={KIND[item.kind].icon} size={13} color={tone} />
            <Text style={[text.label, { color: tone, flex: 1 }]}>{KIND[item.kind].code}</Text>
            <Text style={[text.data, { color: colors.faintForeground }]}>{item.ago}</Text>
          </View>

          <Text
            style={[
              text.heading,
              {
                color: colors.foreground,
                fontFamily: item.read ? font.sansMedium : font.sansSemi,
              },
            ]}
          >
            {item.title}
          </Text>
          <Text style={[text.bodySmall, { color: colors.mutedForeground }]}>{item.body}</Text>
        </View>
      </Pressable>
    );
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

          {unreadCount > 0 && (
            <Pressable onPress={markAllNotificationsRead} hitSlop={8}>
              <Text style={[text.action, { color: colors.accent }]}>Mark all read</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.titleRow}>
          <Text style={[text.display, { color: colors.foreground, flex: 1 }]}>Alerts</Text>
          {unreadCount > 0 && (
            <View style={[styles.countPill, { backgroundColor: colors.accent }]}>
              <Text style={[text.dataMedium, { color: colors.accentForeground }]}>
                {unreadCount} new
              </Text>
            </View>
          )}
        </View>

        {notifications.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={26} color={colors.faintForeground} />
            <Text style={[text.title, { color: colors.foreground, textAlign: 'center' }]}>
              Nothing yet
            </Text>
            <Text
              style={[
                text.body,
                { color: colors.mutedForeground, textAlign: 'center', maxWidth: 260 },
              ]}
            >
              Jobs near you, answers to your questions and payouts all land here.
            </Text>
          </View>
        ) : (
          <>
            {today.length > 0 && (
              <>
                <Text style={[text.label, styles.groupLabel, { color: colors.faintForeground }]}>
                  Today
                </Text>
                {today.map(renderRow)}
              </>
            )}

            {earlier.length > 0 && (
              <>
                <Text style={[text.label, styles.groupLabel, { color: colors.faintForeground }]}>
                  Earlier
                </Text>
                {earlier.map(renderRow)}
              </>
            )}
          </>
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

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22 },
  countPill: { borderRadius: 2, paddingHorizontal: 9, paddingVertical: 5 },

  groupLabel: { marginTop: 28, marginBottom: 10 },

  row: {
    flexDirection: 'row',
    borderWidth: 2,
    borderRadius: 2,
    marginBottom: 8,
    overflow: 'hidden',
  },
  rail: { width: 4 },
  rowBody: { flex: 1, padding: 14, gap: 4 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 70 },
});
