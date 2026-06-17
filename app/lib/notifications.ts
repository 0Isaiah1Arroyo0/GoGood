import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

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

export interface NotifItem {
  id: number;
  name: string;
  icon: string;
  expiryDate: string;
}

// Cancel all scheduled expiry notifications and reschedule from current item list.
export async function rescheduleExpiryNotifications(
  items: NotifItem[],
  enabled: boolean
) {
  // Always cancel existing ones first
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if ((n.content.data as any)?.type === 'expiry') {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  if (!enabled || items.length === 0) return;

  const today = new Date(); today.setHours(0, 0, 0, 0);

  for (const item of items) {
    if (!item.expiryDate) continue;
    const expiry = new Date(item.expiryDate);
    const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);

    // Notify at 8 AM on the day that is (daysLeft - 3) from now
    const notifyDate = new Date(expiry);
    notifyDate.setDate(notifyDate.getDate() - 3);
    notifyDate.setHours(8, 0, 0, 0);

    if (notifyDate <= new Date()) continue; // already past

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
