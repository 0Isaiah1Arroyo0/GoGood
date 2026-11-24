import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Keyboard, Modal, PanResponder, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/app/context/theme';

const SCREEN_H = Dimensions.get('window').height;

// The app's one bottom sheet: the scrim fades in while the sheet slides up on the
// same eased curve, it lifts above the keyboard, and a swipe down on the top strip
// closes it. Used by the inventory and shopping screens so every pop-up feels the same.
export default function BottomSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const { colors } = useTheme();
  const overlay        = useRef(new Animated.Value(0)).current;
  const sheet          = useRef(new Animated.Value(600)).current;
  const insets         = useSafeAreaInsets();
  const restSpace      = Math.max(insets.bottom, 20); // room under the content when the keyboard is down
  // Space at the bottom of the sheet that grows with the keyboard, so the sheet's own
  // background runs right down into the keyboard instead of floating above it.
  const kbSpace        = useRef(new Animated.Value(restSpace)).current;
  const drag           = useRef(new Animated.Value(0)).current; // swipe-down offset
  const measuredSheetH = useRef(0);
  const [mounted, setMounted] = useState(false);

  // Swipe down on the top handle area to close the sheet.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
    onPanResponderMove: (_, g) => { drag.setValue(Math.max(0, g.dy)); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 100 || g.vy > 0.8) {
        Keyboard.dismiss();
        onCloseRef.current();
      } else {
        Animated.spring(drag, { toValue: 0, damping: 20, stiffness: 220, useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(drag, { toValue: 0, damping: 20, stiffness: 220, useNativeDriver: true }).start();
    },
  })).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      drag.setValue(0);
      overlay.setValue(0); sheet.setValue(600);
      // Scrim and sheet move together on one eased curve so neither pops in ahead of the other
      const ease = Easing.out(Easing.cubic);
      Animated.parallel([
        Animated.timing(overlay, { toValue: 1, duration: 420, easing: ease, useNativeDriver: true }),
        Animated.timing(sheet,   { toValue: 0, duration: 420, easing: ease, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      kbSpace.setValue(restSpace);
      const ease = Easing.inOut(Easing.cubic);
      const offscreen = Math.max(600, measuredSheetH.current + 40);
      Animated.parallel([
        Animated.timing(overlay, { toValue: 0, duration: 340, easing: ease, useNativeDriver: true }),
        Animated.timing(sheet,   { toValue: offscreen, duration: 340, easing: ease, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible]);

  useEffect(() => {
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    // Follow the keyboard's own timing and curve so the two move as one piece
    const kbEase = Easing.bezier(0.17, 0.59, 0.4, 0.77);
    const onShow = (e: any) => {
      const kbH = e.endCoordinates?.height ?? 0;
      Animated.timing(kbSpace, { toValue: kbH + 12, duration: e.duration || 250, easing: kbEase, useNativeDriver: false }).start();
    };
    const onHide = (e: any) => {
      Animated.timing(kbSpace, { toValue: restSpace, duration: e.duration || 250, easing: kbEase, useNativeDriver: false }).start();
    };
    const s1 = Keyboard.addListener(showEv, onShow);
    const s2 = Keyboard.addListener(hideEv, onHide);
    return () => { s1.remove(); s2.remove(); };
  }, [restSpace]);

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)', opacity: overlay }]} pointerEvents="none" />
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <Animated.View
          onLayout={e => { measuredSheetH.current = e.nativeEvent.layout.height; }}
          style={{
            backgroundColor: colors.bg,
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingHorizontal: 20, paddingTop: 20, maxHeight: SCREEN_H * 0.92,
            transform: [{ translateY: Animated.add(sheet, drag) }],
          }}
        >
          {/* Drag handle — the whole top strip is grabbable; swipe down to close */}
          <View
            {...panResponder.panHandlers}
            style={{ marginTop: -20, marginHorizontal: -20, paddingTop: 20, paddingBottom: 12, alignItems: 'center' }}
          >
            <View style={{ width: 36, height: 4, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 999 }} />
          </View>
          <View style={{ flexShrink: 1 }}>{children}</View>
          <Animated.View style={{ height: kbSpace }} />
        </Animated.View>
      </View>
    </Modal>
  );
}
