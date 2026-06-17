import { View, Animated, useColorScheme, StyleSheet, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useRef } from 'react';

const { width: SCREEN_W } = Dimensions.get('window');
const H_PAD = 20;
const GAP = 12;
const AVAIL_W = SCREEN_W - H_PAD * 2;

const LIGHT_BG = '#FAF8F3';
const DARK_BG = '#141414';
const LIGHT_BONE = '#E8E5DF';
const DARK_BONE = '#252525';

function Bone({
  w, h, r = 12, opacity,
}: {
  w: number | `${number}%`;
  h: number;
  r?: number;
  opacity: Animated.Value;
}) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return (
    <Animated.View
      style={{
        width: w as any,
        height: h,
        borderRadius: r,
        backgroundColor: isDark ? DARK_BONE : LIGHT_BONE,
        opacity,
      }}
    />
  );
}

export default function AppSplash() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const insets = useSafeAreaInsets();

  const opacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 850, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const bigCardW = Math.round((AVAIL_W - GAP) * 0.61);
  const smallCardW = AVAIL_W - GAP - bigCardW;
  const halfCardW = Math.floor((AVAIL_W - GAP) / 2);

  if (isDark) {
    return (
      <View style={[styles.root, { backgroundColor: DARK_BG, paddingTop: insets.top + 16 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }} />
          <Bone w={32} h={32} r={16} opacity={opacity} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: LIGHT_BG, paddingTop: insets.top + 16 }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ gap: 8, flex: 1, paddingRight: 16 }}>
          <Bone w="58%" h={15} r={7} opacity={opacity} />
          <Bone w="38%" h={11} r={6} opacity={opacity} />
        </View>
        <Bone w={36} h={36} r={18} opacity={opacity} />
      </View>

      <View style={{ height: 22 }} />

      {/* Large + small card row */}
      <View style={styles.row}>
        <Bone w={bigCardW} h={195} r={16} opacity={opacity} />
        <View style={{ width: GAP }} />
        <Bone w={smallCardW} h={195} r={16} opacity={opacity} />
      </View>

      <View style={{ height: 22 }} />

      {/* Section label */}
      <Bone w="32%" h={11} r={6} opacity={opacity} />

      <View style={{ height: 14 }} />

      {/* Two equal cards */}
      <View style={styles.row}>
        <Bone w={halfCardW} h={122} r={16} opacity={opacity} />
        <View style={{ width: GAP }} />
        <Bone w={halfCardW} h={122} r={16} opacity={opacity} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: H_PAD,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
});
