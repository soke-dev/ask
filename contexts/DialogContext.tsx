import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';

type Tone = 'default' | 'danger' | 'primary';

type ConfirmOptions = {
  title: string;
  message?: string;
  /** Defaults to "Continue". */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** Colours the confirming button. 'danger' for anything irreversible. */
  tone?: Tone;
};

type NotifyOptions = { title: string; message?: string; okLabel?: string };

type Request =
  | ({ kind: 'confirm' } & ConfirmOptions)
  | ({ kind: 'notify' } & NotifyOptions);

type Dialogs = {
  /** Resolves true if they went ahead. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Resolves once they have acknowledged it. */
  notify: (options: NotifyOptions) => Promise<void>;
};

const DialogContext = createContext<Dialogs | null>(null);

/**
 * The app's own dialogs, in place of `Alert.alert`.
 *
 * The system alert is the one piece of the app drawn by somebody else: iOS
 * rounds it, uses its own typeface and its own blue, and puts the destructive
 * choice wherever the platform prefers. On a screen built out of 2px edges and
 * a monospaced signage face it reads as a different application interrupting
 * this one — which is a poor look on the exact moments that matter most, since
 * every one of these is about money.
 *
 * The imperative shape is kept on purpose. Turning each of these into local
 * `visible` state at the call site would spread a modal's lifecycle across
 * whatever else that screen is doing, and the calls read better as a question
 * asked and answered:
 *
 *     if (await confirm({ title: 'Close and refund ₦150?', tone: 'danger' })) …
 */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [request, setRequest] = useState<Request | null>(null);
  /** Settles the promise the caller is waiting on. */
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const close = useCallback((answer: boolean) => {
    setRequest(null);
    resolver.current?.(answer);
    resolver.current = null;
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    setRequest({ kind: 'confirm', ...options });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const notify = useCallback((options: NotifyOptions) => {
    setRequest({ kind: 'notify', ...options });
    return new Promise<void>((resolve) => {
      resolver.current = () => resolve();
    });
  }, []);

  const accent =
    request?.kind === 'confirm' && request.tone === 'danger'
      ? colors.danger
      : colors.primary;

  return (
    <DialogContext.Provider value={{ confirm, notify }}>
      {children}

      <Modal
        visible={request !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        /**
         * Dismissing by the back button or the backdrop answers "no". A
         * confirm that resolved true on a stray tap would be the worst
         * possible default for the things this is asked about.
         */
        onRequestClose={() => close(false)}
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={() => close(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.card,
              {
                backgroundColor: colors.background,
                borderColor: accent,
                marginBottom: insets.bottom,
              },
            ]}
          >
            <View style={[styles.rule, { backgroundColor: accent }]} />

            <Text style={[text.title, { color: colors.foreground }]}>{request?.title}</Text>

            {request?.message ? (
              <Text style={[text.body, { color: colors.mutedForeground, marginTop: 8 }]}>
                {request.message}
              </Text>
            ) : null}

            <View style={styles.actions}>
              {request?.kind === 'confirm' && (
                <Pressable
                  onPress={() => close(false)}
                  style={({ pressed }) => [
                    styles.button,
                    { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[text.action, { color: colors.mutedForeground }]}>
                    {request.cancelLabel ?? 'Cancel'}
                  </Text>
                </Pressable>
              )}

              <Pressable
                onPress={() => close(true)}
                style={({ pressed }) => [
                  styles.button,
                  styles.solid,
                  { backgroundColor: accent, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={[text.action, { color: colors.background }]}>
                  {request?.kind === 'confirm'
                    ? (request.confirmLabel ?? 'Continue')
                    : (request?.okLabel ?? 'OK')}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </DialogContext.Provider>
  );
}

export function useDialog(): Dialogs {
  const value = useContext(DialogContext);
  if (!value) throw new Error('useDialog must be used inside DialogProvider');
  return value;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26 },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 18,
  },
  // The same accent bar the boot screen uses, so a dialog is recognisably part
  // of this app rather than something the operating system put there.
  rule: { width: 40, height: 2, marginBottom: 14 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 22 },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 14,
  },
  solid: { borderColor: 'transparent' },
});
