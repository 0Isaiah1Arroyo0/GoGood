import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('expiry', {
      name: 'Expiry Alerts',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// Register for Expo push notifications and return the token string.
// Returns null on simulators, web, or when permission is denied.
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return null;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      if (__DEV__) console.warn('[Push] No EAS projectId found — push token skipped');
      return null;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    return token ?? null;
  } catch (e) {
    // Simulators throw here — swallow silently in dev, log in prod
    if (!__DEV__) console.error('[Push] registerForPushNotificationsAsync failed', e);
    return null;
  }
}

// The local day an item counts as "gone bad" — the first midnight at least a full
// day after its expiry date. Matches getDaysLeft() < 0 in the inventory screen.
function goneBadDay(expiryDate: string): Date {
  const threshold = new Date(new Date(expiryDate).getTime() + 86400000);
  const day = new Date(threshold);
  day.setHours(0, 0, 0, 0);
  if (day < threshold) day.setDate(day.getDate() + 1);
  return day;
}

// One notification per day that items go bad: "1 item has gone bad" / "3 items have gone bad".
async function scheduleGoneBadNotifications(items: NotifItem[]) {
  const counts = new Map<string, { date: Date; count: number }>();
  for (const item of items) {
    if (!item.expiryDate) continue;
    const day = goneBadDay(item.expiryDate);
    if (isNaN(day.getTime())) continue;
    const key = day.toDateString();
    const entry = counts.get(key) ?? { date: day, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }

  for (const { date, count } of counts.values()) {
    const notifyAt = new Date(date);
    notifyAt.setHours(9, 0, 0, 0);
    if (notifyAt <= new Date()) continue;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${count} item${count === 1 ? ' has' : 's have'} gone bad`,
        body: 'Tap now to prevent future items from going bad.',
        data: { type: 'gone_bad', count },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: notifyAt },
    });
  }
}

export interface NotifItem {
  id: number;
  name: string;
  icon: string;
  expiryDate: string;
}

// Cancel all scheduled expiry notifications and reschedule from current item list.
// Calls are queued so overlapping reschedules can't create duplicate notifications.
let rescheduleQueue: Promise<void> = Promise.resolve();
export function rescheduleExpiryNotifications(items: NotifItem[], enabled: boolean): Promise<void> {
  rescheduleQueue = rescheduleQueue
    .then(() => doReschedule(items, enabled))
    .catch(e => { if (__DEV__) console.warn('[notifications] reschedule failed', e); });
  return rescheduleQueue;
}

async function doReschedule(items: NotifItem[], enabled: boolean) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    const type = (n.content.data as any)?.type;
    if (type === 'expiry' || type === 'gone_bad') {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  if (!enabled || items.length === 0) return;

  await scheduleGoneBadNotifications(items);

  const today = new Date(); today.setHours(0, 0, 0, 0);

  for (const item of items) {
    if (!item.expiryDate) continue;
    const expiry = new Date(item.expiryDate);
    const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);

    const notifyDate = new Date(expiry);
    notifyDate.setDate(notifyDate.getDate() - 3);
    notifyDate.setHours(8, 0, 0, 0);

    if (notifyDate <= new Date()) continue;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${item.icon} ${item.name} expires soon`,
        body: `${item.name} expires in 3 days — use it before it goes bad.`,
        data: { type: 'expiry', itemId: item.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: notifyDate },
    });
  }
}
