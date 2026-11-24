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
      lightColor: '#0F7855',
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

// "Milk", "Milk and Eggs", "Milk, Eggs and Spinach", "Milk, Eggs and 3 more"
function listNames(names: string[], max = 3): string {
  const clean = names.map(n => n.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? '';
  if (clean.length <= max) return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
  return `${clean.slice(0, max - 1).join(', ')} and ${clean.length - (max - 1)} more`;
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Shared look for every GoGood alert: grouped together on the lock screen, on the
// expiry channel on Android, no emojis.
function baseContent(group: string) {
  return {
    threadIdentifier: group,                       // iOS: stack GoGood alerts together
    ...(Platform.OS === 'android' ? { color: '#0F7855' } : {}),
    sound: false as const,
  };
}
function trigger(date: Date) {
  return {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date,
    ...(Platform.OS === 'android' ? { channelId: 'expiry' } : {}),
  } as Notifications.DateTriggerInput;
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
  const counts = new Map<string, { date: Date; names: string[] }>();
  for (const item of items) {
    if (!item.expiryDate) continue;
    const day = goneBadDay(item.expiryDate);
    if (isNaN(day.getTime())) continue;
    const key = day.toDateString();
    const entry = counts.get(key) ?? { date: day, names: [] };
    entry.names.push(item.name);
    counts.set(key, entry);
  }

  for (const { date, names } of counts.values()) {
    const count = names.length;
    const notifyAt = new Date(date);
    notifyAt.setHours(9, 0, 0, 0);
    if (notifyAt <= new Date()) continue;
    await Notifications.scheduleNotificationAsync({
      content: {
        ...baseContent('gogood-gone-bad'),
        title: count === 1 ? `${names[0]} went bad` : `${count} items went bad`,
        body: count === 1
          ? 'It passed its date. See what else is expiring so nothing else goes to waste.'
          : `${listNames(names)} passed their dates. See what's expiring next so nothing else goes to waste.`,
        data: { type: 'gone_bad', count },
      },
      trigger: trigger(notifyAt),
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

  // One "expiring soon" alert per day, listing everything that expires in 3 days,
  // instead of a separate notification for every item.
  const byDay = new Map<string, { date: Date; expiry: Date; items: NotifItem[] }>();
  for (const item of items) {
    if (!item.expiryDate) continue;
    const expiry = new Date(item.expiryDate);
    if (isNaN(expiry.getTime())) continue;
    const notifyDate = new Date(expiry);
    notifyDate.setDate(notifyDate.getDate() - 3);
    notifyDate.setHours(8, 0, 0, 0);
    if (notifyDate <= new Date()) continue;
    const key = notifyDate.toDateString();
    const entry = byDay.get(key) ?? { date: notifyDate, expiry, items: [] };
    entry.items.push(item);
    byDay.set(key, entry);
  }

  for (const { date, expiry, items: dayItems } of byDay.values()) {
    const names = dayItems.map(i => i.name);
    const day = WEEKDAY[expiry.getDay()];
    await Notifications.scheduleNotificationAsync({
      content: {
        ...baseContent('gogood-expiry'),
        title: dayItems.length === 1 ? `${names[0]} expires in 3 days` : `${dayItems.length} items expire in 3 days`,
        body: dayItems.length === 1
          ? `Use it by ${day} so it doesn't go to waste.`
          : `${listNames(names)}. Plan a meal around them before ${day}.`,
        data: { type: 'expiry', itemIds: dayItems.map(i => i.id) },
      },
      trigger: trigger(date),
    });
  }
}
