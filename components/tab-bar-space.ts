import { useSafeAreaInsets } from 'react-native-safe-area-context';

// The bottom navigation floats over the screens, so scrollable content needs extra
// bottom padding to clear it. These are shared with app/(tabs)/_layout.tsx.
export const TAB_BAR_MINI_H = 42; // height of the shrunk bar
export const TAB_BAR_GAP    = 8;  // breathing room above the bar

export function tabBarBottomOffset(insetBottom: number): number {
  return insetBottom > 0 ? insetBottom : 12;
}

// Space a screen should leave at the bottom so its last item isn't hidden by the bar.
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return tabBarBottomOffset(insets.bottom) + TAB_BAR_MINI_H + TAB_BAR_GAP;
}
