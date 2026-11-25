import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/app/context/theme';
import { raised, raisedGreen } from '@/components/raised';

// The app's own pop-up, used instead of the iPhone's system alert so questions,
// confirmations and choice menus look like the rest of Go Good.
//
//   showAlert('Delete recipe?', 'This cannot be undone.', [
//     { text: 'Cancel', style: 'cancel' },
//     { text: 'Delete', style: 'destructive', onPress: remove },
//   ]);
//
// Same arguments as Alert.alert. iOS can only show one window (Modal) at a time, so
// every Modal in the app includes a <DialogHost />; the most recently opened one
// draws the pop-up, which puts it on top of whatever sheet is showing.

export type DialogButton = {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
};
type Dialog = { title: string; message?: string; buttons: DialogButton[] };

let current: Dialog | null = null;
const hosts: number[] = [];
const listeners = new Set<() => void>();
let nextHostId = 1;
const notify = () => listeners.forEach(l => l());

export function showAlert(title: string, message?: string, buttons?: DialogButton[]) {
  const list = buttons?.length ? buttons : [{ text: 'OK' }];
  if (!hosts.length) {
    // Nothing on screen can draw it yet (e.g. during start-up): use the system alert
    Alert.alert(title, message, list as any);
    return;
  }
  current = { title, message, buttons: list };
  notify();
}

// Icons for common choices, so menus read at a glance
const ICONS: [RegExp, keyof typeof Ionicons.glyphMap][] = [
  [/take photo|camera/i, 'camera-outline'],
  [/photo library|library|choose photo/i, 'images-outline'],
  [/one item/i, 'pricetag-outline'],
  [/several items/i, 'albums-outline'],
  [/^delete|remove|clear/i, 'trash-outline'],
  [/log ?out|leave/i, 'log-out-outline'],
  [/disconnect/i, 'unlink-outline'],
  [/rename|edit/i, 'create-outline'],
  [/add manually/i, 'add-outline'],
  [/try again/i, 'refresh-outline'],
  [/view recipes|go to/i, 'arrow-forward-outline'],
  [/settings/i, 'settings-outline'],
  [/upgrade|premium|pro\b/i, 'sparkles-outline'],
];
const iconFor = (b: DialogButton) => b.icon ?? ICONS.find(([re]) => re.test(b.text ?? ''))?.[1];

const DANGER = '#E0574A';

export function DialogHost() {
  const { colors: c, isDark } = useTheme();
  const id = useRef(0);
  const [, force] = useState(0);
  const [shown, setShown] = useState<Dialog | null>(null);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    id.current = nextHostId++;
    hosts.push(id.current);
    const l = () => force(n => n + 1);
    listeners.add(l);
    notify();
    return () => {
      const i = hosts.indexOf(id.current);
      if (i >= 0) hosts.splice(i, 1);
      listeners.delete(l);
      notify(); // another host takes over anything still showing
    };
  }, []);

  const isTop = hosts[hosts.length - 1] === id.current;
  const want = isTop ? current : null;

  useEffect(() => {
    if (want && want !== shown) {
      setShown(want);
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, damping: 22, stiffness: 260, useNativeDriver: true }).start();
      Haptics.selectionAsync().catch(() => {});
    } else if (!want && shown) {
      setShown(null);
    }
  }, [want]);

  if (!shown) return null;

  const close = (b?: DialogButton) => {
    Animated.timing(anim, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
      if (current === shown) { current = null; notify(); }
      setShown(null);
      b?.onPress?.();
    });
  };

  const cancel   = shown.buttons.find(b => b.style === 'cancel');
  const actions  = shown.buttons.filter(b => b.style !== 'cancel');
  // A lone button ("OK", "Got it") is the main action: green
  const solo     = actions.length === 1 && !cancel && actions[0].style !== 'destructive';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.38)', opacity: anim }]}>
        <Pressable style={{ flex: 1 }} onPress={() => close(cancel)} />
      </Animated.View>
      <Animated.View
        style={[
          s.card,
          { backgroundColor: c.surface },
          raised(isDark, 'md'),
          { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] },
        ]}
      >
        <Text style={[s.title, { color: c.text }]}>{shown.title}</Text>
        {shown.message ? <Text style={[s.message, { color: c.textSub }]}>{shown.message}</Text> : null}

        <View style={{ gap: 8, marginTop: 16 }}>
          {actions.map((b, i) => {
            const danger = b.style === 'destructive';
            const icon = iconFor(b);
            const color = solo ? c.btnPrimaryText : danger ? DANGER : c.text;
            return (
              <TouchableOpacity
                key={`${b.text}-${i}`}
                onPress={() => close(b)}
                activeOpacity={0.85}
                style={[
                  s.btn,
                  solo
                    ? [{ backgroundColor: c.btnPrimary }, raisedGreen(isDark)]
                    : [{ backgroundColor: c.surfaceAlt }, raised(isDark)],
                ]}
              >
                {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
                <Text style={[s.btnText, { color }]}>{b.text ?? 'OK'}</Text>
              </TouchableOpacity>
            );
          })}
          {cancel ? (
            <TouchableOpacity onPress={() => close(cancel)} activeOpacity={0.7} style={s.cancel}>
              <Text style={[s.cancelText, { color: c.textSub }]}>{cancel.text ?? 'Cancel'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  card:       { position: 'absolute', left: 12, right: 12, bottom: 34, borderRadius: 24, padding: 20, paddingBottom: 12 },
  title:      { fontSize: 19, fontFamily: 'Fraunces_600SemiBold', lineHeight: 25 },
  message:    { fontSize: 14, lineHeight: 20, marginTop: 6 },
  btn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 14 },
  btnText:    { fontSize: 15, fontWeight: '600' },
  cancel:     { alignItems: 'center', paddingVertical: 12 },
  cancelText: { fontSize: 15, fontWeight: '600' },
});
