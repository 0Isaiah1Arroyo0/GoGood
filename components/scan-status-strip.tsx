import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarSpace } from '@/components/tab-bar-space';
import { DialogHost } from '@/components/dialog';

// The green "working on it" card that slides up from the bottom while a scan or
// import runs: three pulsing dots, a title, a note, a slow-down hint and Cancel.
// Shared by the inventory scans and the recipe importer so both look the same.
export default function ScanStatusStrip({ visible, label, sublabel, blocking = false, slowHint, onCancel, bottom }: {
  visible: boolean; label: string; sublabel: string;
  blocking?: boolean;   // cover the whole app so a stray tap can't leave mid-scan
  slowHint?: string;    // shown under the sublabel once the scan has run a while
  onCancel?: () => void; // shows a Cancel button that stops waiting for the scan
  bottom?: number;       // distance from the screen bottom (defaults to just above the tab bar)
}) {
  const insets = useSafeAreaInsets();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!visible) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [visible]);
  const tabSpace = useTabBarSpace();
  const bottomGap = bottom ?? tabSpace + 8; // sit above the floating bottom bar
  const translateY = useRef(new Animated.Value(120)).current;
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;
  const dotLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, { toValue: 0, damping: 22, stiffness: 260, useNativeDriver: true }).start();
      dotLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(dot1, { toValue: 1,   duration: 220, useNativeDriver: true }),
          Animated.timing(dot1, { toValue: 0.3, duration: 220, useNativeDriver: true }),
          Animated.timing(dot2, { toValue: 1,   duration: 220, useNativeDriver: true }),
          Animated.timing(dot2, { toValue: 0.3, duration: 220, useNativeDriver: true }),
          Animated.timing(dot3, { toValue: 1,   duration: 220, useNativeDriver: true }),
          Animated.timing(dot3, { toValue: 0.3, duration: 220, useNativeDriver: true }),
        ])
      );
      dotLoopRef.current.start();
    } else {
      dotLoopRef.current?.stop();
      dot1.setValue(0.3); dot2.setValue(0.3); dot3.setValue(0.3);
      Animated.timing(translateY, { toValue: 120, duration: 200, useNativeDriver: true }).start();
    }
    return () => dotLoopRef.current?.stop();
  }, [visible]);

  const card = (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={{
        position: 'absolute', bottom: bottomGap, left: 16, right: 16,
        paddingBottom: 16,
        paddingTop: 18, paddingHorizontal: 24,
        backgroundColor: '#0A5740',
        flexDirection: 'row', alignItems: 'center', gap: 16,
        borderRadius: 16,
        shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.2, shadowRadius: 10, elevation: 10,
        opacity: translateY.interpolate({ inputRange: [0, 120], outputRange: [1, 0] }),
        transform: [{ translateY: translateY.interpolate({ inputRange: [0, 120], outputRange: [0, 40] }) }],
        zIndex: 200,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
        {([dot1, dot2, dot3] as Animated.Value[]).map((dot, i) => (
          <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#5DCAA5', opacity: dot }} />
        ))}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600', fontFamily: 'Fraunces_400Regular' }}>{label}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 2, lineHeight: 17 }}>{sublabel}</Text>
        {slowHint && elapsed >= 12 ? (
          <Text style={{ color: '#5DCAA5', fontSize: 12, marginTop: 6, lineHeight: 17 }}>{slowHint}</Text>
        ) : null}
      </View>
      {onCancel ? (
        <TouchableOpacity
          onPress={onCancel}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{ alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)' }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>Cancel</Text>
        </TouchableOpacity>
      ) : null}
    </Animated.View>
  );

  if (!blocking) return card;
  // Blocking: dim and cover everything (including the bottom bar) until the scan finishes
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }}>
        {card}
      </View>
      <DialogHost />
    </Modal>
  );
}
