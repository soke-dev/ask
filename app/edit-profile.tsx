import React, { useEffect, useState } from 'react';
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
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import { font, text } from '@/constants/type';
import { useApp, type Area } from '@/contexts/AppContext';
import { apiFetch, hasApi, uploadAvatar } from '@/utils/api';
import { AreaPicker, type AreaChoice } from '@/components/AreaPicker';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
const USERNAME_RULE = /^[a-z0-9_]{3,20}$/;

export default function EditProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { profile, updateProfile, homeArea, setHomeArea, user, identity } = useApp();
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  const [username, setUsername] = useState(profile.username);
  const [avatarUri, setAvatarUri] = useState(profile.avatarUri);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [area, setArea] = useState<Area | null>(homeArea);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [areaOpen, setAreaOpen] = useState(false);
  const usernameValid = USERNAME_RULE.test(username);
  const canSave = usernameValid;

  /** Only the ID check can produce a name, so that is what proves one. */
  const nameVerified = identity.status === 'verified' && profile.name.length > 0;

  const initials = (username || user?.email || 'U').slice(0, 2).toUpperCase();


  async function pickPhoto(fromCamera: boolean) {
    setPhotoError(null);
    try {
      const permission = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        setPhotoError('Permission declined.');
        return;
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.6,
      };

      const result = fromCamera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

      if (result.canceled || !result.assets?.length) return;
      setAvatarUri(result.assets[0].uri);
    } catch {
      setPhotoError('Could not open the picker on this device.');
    }
  }

  /**
   * Saves to the server first, and only closes if that worked.
   *
   * This used to write to app state alone. Everything looked saved until the
   * next sign-in read the server's copy back — at which point the username and
   * the area reverted, because they had never left the phone.
   *
   * The avatar is still local-only: it is a file, not a field, and needs
   * upload storage that does not exist yet. It survives this session and no
   * longer, which is why nothing here claims otherwise.
   */
  async function save() {
    if (!canSave || saving) return;
    setSaveError(null);

    if (hasApi) {
      setSaving(true);

      /**
       * The picture goes first, and a failure here stops the save.
       *
       * Letting the text fields succeed while the upload failed would close
       * the screen showing the new avatar locally, with nothing stored — which
       * is exactly how it appeared to save and then vanished on refresh.
       */
      if (avatarUri && avatarUri !== profile.avatarUri) {
        const upload = await uploadAvatar(avatarUri);
        if (!upload.ok) {
          setSaving(false);
          setSaveError(`Could not upload the picture — ${upload.detail}`);
          return;
        }
      }

      const result = await apiFetch<{ ok: true }>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
          username: username.trim(),
          ...(area
            ? { homeArea: area.label, homeState: area.state, homeCountry: 'Nigeria' }
            : {}),
        }),
      });
      setSaving(false);

      if (!result.ok) {
        setSaveError(
          result.code === 'username_taken'
            ? 'That username is taken. Try another.'
            : `Could not save — ${result.detail}`,
        );
        return;
      }
    }

    updateProfile({ username: username.trim(), avatarUri });
    if (area) setHomeArea(area);
    router.back();
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingTop: topPad }]}
      >
        <Pressable
          onPress={() => router.back()}
          style={[styles.backBtn, { borderColor: colors.border }]}
        >
          <Ionicons name="arrow-back" size={18} color={colors.foreground} />
        </Pressable>

        <Text style={[text.display, { color: colors.foreground, marginTop: 22 }]}>
          Edit profile
        </Text>

        {/* ── Photo ────────────────────────────────────────────────── */}
        <View style={styles.photoRow}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.foreground }]}>
              <Text style={[styles.initials, { color: colors.background }]}>{initials}</Text>
            </View>
          )}

          <View style={styles.photoActions}>
            <Pressable
              onPress={() => pickPhoto(true)}
              style={({ pressed }) => [
                styles.photoBtn,
                { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="camera-outline" size={14} color={colors.foreground} />
              <Text style={[text.action, { fontSize: 11, color: colors.foreground }]}>Take</Text>
            </Pressable>
            <Pressable
              onPress={() => pickPhoto(false)}
              style={({ pressed }) => [
                styles.photoBtn,
                { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="images-outline" size={14} color={colors.foreground} />
              <Text style={[text.action, { fontSize: 11, color: colors.foreground }]}>Choose</Text>
            </Pressable>
            {avatarUri && (
              <Pressable
                onPress={() => setAvatarUri(null)}
                style={({ pressed }) => [
                  styles.photoBtn,
                  { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[text.action, { fontSize: 11, color: colors.mutedForeground }]}>
                  Remove
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        {photoError && (
          <Text style={[text.bodySmall, { color: colors.danger, marginTop: 8 }]}>{photoError}</Text>
        )}

        {/* ── Name ─────────────────────────────────────────────────────
            Not an input. A name anyone can type is not identity, and this
            field used to accept anything while looking authoritative. It now
            shows only what the ID check returned, or an honest blank. */}
        <Text style={[text.label, styles.fieldLabel, { color: colors.faintForeground }]}>
          Your name
        </Text>
        {/* Four states, not two. Offering "Verify" to someone whose check is
            already in the queue invites a duplicate submission the server has
            to reject, and tells them nothing about where it got to. */}
        {nameVerified ? (
          <View style={[styles.readonlyField, { borderColor: colors.border }]}>
            <Text style={[text.body, { color: colors.foreground, flex: 1 }]}>{profile.name}</Text>
            <Ionicons name="shield-checkmark" size={16} color={colors.primary} />
          </View>
        ) : identity.status === 'pending' ? (
          <View style={[styles.readonlyField, { borderColor: colors.pending }]}>
            <Text style={[text.body, { color: colors.pending, flex: 1 }]}>
              Waiting on review
            </Text>
            <Ionicons name="hourglass-outline" size={16} color={colors.pending} />
          </View>
        ) : (
          <Pressable
            onPress={() => router.push('/verify-identity')}
            style={({ pressed }) => [
              styles.readonlyField,
              {
                borderColor: identity.status === 'rejected' ? colors.danger : colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text
              style={[
                text.body,
                {
                  color:
                    identity.status === 'rejected' ? colors.danger : colors.faintForeground,
                  flex: 1,
                },
              ]}
            >
              {identity.status === 'rejected' ? 'Not approved' : 'Not verified yet'}
            </Text>
            <Text style={[text.data, { color: colors.accent }]}>
              {identity.status === 'rejected' ? 'Try again' : 'Verify'}
            </Text>
            <Ionicons name="chevron-forward" size={15} color={colors.accent} />
          </Pressable>
        )}
        <Text style={[text.data, { color: colors.faintForeground, marginTop: 6 }]}>
          {nameVerified
            ? 'Read from your ID record. Others still only ever see your username.'
            : identity.status === 'pending'
              ? 'Someone is checking it by hand. Your name appears here once approved.'
              : identity.status === 'rejected' && identity.reason
                ? identity.reason
                : 'Your name comes from the ID check, never from typing. Until then you are just your username.'}
        </Text>

        {/* ── Username ─────────────────────────────────────────────── */}
        <Text style={[text.label, styles.fieldLabel, { color: colors.faintForeground }]}>
          Username
        </Text>
        <View
          style={[
            styles.field,
            styles.usernameField,
            {
              backgroundColor: colors.surface,
              borderColor: usernameValid ? colors.border : colors.danger,
            },
          ]}
        >
          <Text style={[styles.at, { color: colors.faintForeground }]}>@</Text>
          <TextInput
            style={[styles.usernameInput, { color: colors.foreground }]}
            value={username}
            onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            placeholder="akin"
            placeholderTextColor={colors.faintForeground}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
          />
        </View>
        <Text
          style={[
            text.data,
            { color: usernameValid ? colors.faintForeground : colors.danger, marginTop: 6 },
          ]}
        >
          {usernameValid
            ? 'Lowercase letters, numbers and underscores.'
            : '3 to 20 characters. Lowercase letters, numbers and underscores.'}
        </Text>

        {/* ── Area ─────────────────────────────────────────────────── */}
        <Text style={[text.label, styles.fieldLabel, { color: colors.faintForeground }]}>
          Location
        </Text>
        <Pressable
          onPress={() => setAreaOpen(true)}
          style={({ pressed }) => [
            styles.areaBtn,
            { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="location" size={16} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[text.heading, { color: colors.foreground }]}>
              {area?.label ?? 'Not set'}
            </Text>
            <Text style={[text.data, { color: colors.faintForeground }]}>
              {area?.state ?? 'Choose where you are'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
        </Pressable>
        <Text style={[text.data, { color: colors.faintForeground, marginTop: 6 }]}>
          {area
            ? `Questions and answers on the Ask tab are drawn from here first, then the rest of ${area.state}.`
            : 'Until you set this, the Ask tab shows answers from everywhere rather than near you.'}
        </Text>

        <Pressable
          onPress={save}
          disabled={!canSave || saving}
          style={({ pressed }) => [
            styles.saveBtn,
            {
              backgroundColor: canSave ? colors.primary : colors.sunken,
              opacity: pressed ? 0.88 : 1,
            },
          ]}
        >
          <Text
            style={[
              text.action,
              { color: canSave ? colors.primaryForeground : colors.faintForeground },
            ]}
          >
            {saving ? 'Saving' : 'Save changes'}
          </Text>
        </Pressable>

        {saveError && (
          <Text style={[text.bodySmall, { color: colors.danger, marginTop: 10 }]}>
            {saveError}
          </Text>
        )}
      </KeyboardAwareScrollViewCompat>

      {/* ── Area sheet ─────────────────────────────────────────────── */}
      {/* ── Where they are ─────────────────────────────────────────
          The same country → state → area picker as onboarding.

          It used to search live place data through a geocoding provider,
          which answered a different question: a search for "Ikeja" returns
          streets and businesses, and the app needs the local government area
          the jobs are filtered by. A fixed list of the 774 LGAs cannot return
          something that is not one. */}
      <Modal
        visible={areaOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAreaOpen(false)}
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={() => setAreaOpen(false)}
        >
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
            <Text style={[text.title, { color: colors.foreground }]}>Select location</Text>
            <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 4 }]}>
              Where you take jobs and see questions.
            </Text>

            <View style={{ marginTop: 16 }}>
              <AreaPicker
                value={area ? { country: 'Nigeria', state: area.state, lga: area.label } : null}
                onChange={(picked: AreaChoice) => {
                  setArea({
                    key: picked.lga.toLowerCase().replace(/\s+/g, '-'),
                    label: picked.lga,
                    state: picked.state,
                  });
                  setAreaOpen(false);
                }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 48 },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 24 },
  avatar: { width: 72, height: 72, borderRadius: 2 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: font.monoMedium, fontSize: 24 },
  photoActions: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },

  fieldLabel: { marginTop: 26, marginBottom: 8 },
  field: {
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: font.sans,
    fontSize: 16,
  },
  readonlyField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 15,
    marginTop: 7,
  },
  usernameField: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 0 },
  at: { fontFamily: font.monoMedium, fontSize: 16 },
  usernameInput: { flex: 1, fontFamily: font.mono, fontSize: 16, paddingVertical: 13 },

  areaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },

  saveBtn: {
    borderRadius: 2,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 32,
  },

  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '86%',
  },
  grabber: { width: 38, height: 3, alignSelf: 'center', marginBottom: 16 },
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
});
