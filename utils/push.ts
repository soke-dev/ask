import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { apiFetch } from '@/utils/api';

/**
 * The phone's own notification centre, as distinct from the bell in the app.
 *
 * The in-app feed only exists while somebody is looking at it, which is the
 * wrong time to tell them a job appeared near them or their money arrived.
 * These are the notifications that reach a locked screen.
 */

/**
 * How a notification behaves when it lands while the app is open.
 *
 * Shown rather than swallowed: the alternative is that the one moment you are
 * demonstrably paying attention is the one moment the app stays quiet.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/** Registers this device for push, and tells the server where to reach it. */
export async function registerForPush(): Promise<string | null> {
  /**
   * A simulator has no push token to give.
   *
   * Asking anyway returns an error that reads like a configuration problem and
   * is not one, which is a bad thing to leave in the logs of anybody working
   * on this.
   */
  if (!Device.isDevice) return null;

  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;

    if (status !== 'granted') {
      // Only asks if it has not been answered. iOS refuses a second prompt
      // anyway, and asking again on Android is just noise.
      if (!existing.canAskAgain) return null;
      ({ status } = await Notifications.requestPermissionsAsync());
    }

    if (status !== 'granted') return null;

    /**
     * Android needs a channel before anything can be delivered to it.
     *
     * Created here rather than at import time so it happens after permission,
     * and named for what it is: everything this app sends is about money or a
     * job somebody is waiting on, so none of it belongs in a low-priority
     * channel the system may batch until morning.
     */
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Jobs and payments',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    // The EAS project id is what routes a token to this app. Reading it from
    // the manifest rather than hardcoding keeps dev and production honest.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

    await apiFetch('/push/register', {
      method: 'POST',
      body: JSON.stringify({ token, platform: Platform.OS }),
    });

    return token;
  } catch (error) {
    // Never fatal. Somebody who cannot receive push can still use every part
    // of the app; the alternative is a crash on launch over a nicety.
    if (__DEV__) console.warn('[push] could not register:', error);
    return null;
  }
}

/** Stops this device ringing for the account signing out. */
export async function unregisterPush(token: string | null): Promise<void> {
  if (!token) return;
  try {
    await apiFetch('/push/unregister', { method: 'POST', body: JSON.stringify({ token }) });
  } catch {
    // Signing out must not fail because a cleanup call did.
  }
}
