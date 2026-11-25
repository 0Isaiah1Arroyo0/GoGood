import { useRef } from 'react';
import { Animated, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '@/app/context/theme';
import { raised, raisedGreen } from '@/components/raised';

// The round "+" button in the top-right of a screen header. One shared component so
// it looks and feels identical everywhere (matches the inventory screen's original).
export default function HeaderAddButton({ onPress, accessibilityLabel = 'Add' }: {
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const { colors, isDark } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.btn,
          raisedGreen(isDark, 'sm'),
          {
            backgroundColor: colors.btnPrimary,
            shadowColor: isDark ? '#8DB89A' : '#085041',
            shadowOpacity: isDark ? 0.25 : 0.2,
          },
        ]}
        onPress={onPress}
        onPressIn={() => Animated.spring(scale, { toValue: 0.85, useNativeDriver: true }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, damping: 10, stiffness: 260, useNativeDriver: true }).start()}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.plus}>+</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    shadowOffset: { width: 0, height: 5 }, shadowRadius: 14, elevation: 8,
  },
  plus: { color: 'white', fontSize: 22, lineHeight: 22, fontWeight: '300', includeFontPadding: false, marginTop: 1 },
});
