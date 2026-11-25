import { Tabs } from 'expo-router';
import { View, Text, TouchableOpacity, Animated, Easing, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRef, useEffect, useState } from 'react';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TAB_BAR_MINI_H, TAB_BAR_GAP, tabBarBottomOffset } from '@/components/tab-bar-space';
import { useTheme } from '../context/theme';
import { useSubscription } from '../context/subscription';
import PendingInvitePrompt from '../components/PendingInvitePrompt';

// Line icons: outlined normally, filled for the screen you're on
type IconName = keyof typeof Ionicons.glyphMap;
const TABS: { name: string; icon: IconName; iconOn: IconName; label: string }[] = [
  { name: 'index',       icon: 'nutrition-outline',   iconOn: 'nutrition',   label: 'Inventory' },
  { name: 'goodbot',     icon: 'sparkles-outline',    iconOn: 'sparkles',    label: 'Good Bot'  },
  { name: 'collections', icon: 'book-outline',        iconOn: 'book',        label: 'Recipes'   },
  { name: 'shopping',    icon: 'cart-outline',        iconOn: 'cart',        label: 'Shop'      },
  { name: 'foodreport',  icon: 'stats-chart-outline', iconOn: 'stats-chart', label: 'Report'    },
  { name: 'household',   icon: 'home-outline',        iconOn: 'home',        label: 'Household' },
];

// Soft fade drawn just above the tab bar so screen content dissolves into the
// background instead of being cut off — applies to every tab screen.
const BOTTOM_FADE_H = 40;
function bottomFadeGradient(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Ease from clear (top) to solid at ~60%, then stay solid behind the bar.
  const stops = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 1].map(t => {
    const k = Math.min(1, t / 0.6);
    const alpha = k * k * (3 - 2 * k);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)}) ${Math.round(t * 100)}%`;
  }).join(', ');
  return `linear-gradient(to bottom, ${stops})`;
}

const DOCK_H       = 66;   // full bar height (icon + label)
const MINI_H       = TAB_BAR_MINI_H; // shrunk bar height (icons only)
const DOCK_H_SIDE  = 12;   // full bar inset from the screen edges
const MINI_WIDTH   = 0.7;  // shrunk bar width, as a fraction of the full bar
const AUTO_HIDE_MS   = 7000; // bar opened from the small bar, nothing picked
const AFTER_SWITCH_MS = 3000; // after switching screens
const ON_LAUNCH_MS   = 4000; // first time the app opens

// Bottom navigation that shrinks into a smaller version of itself (icons only)
// when you're settled on a screen. Tap the small bar to grow it back; pick a tab
// and it shrinks again.
function FloatingDock({ state, navigation }: BottomTabBarProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();

  const scales = useRef(TABS.map(() => new Animated.Value(1))).current;
  const prevIndex = useRef(state.index);

  // 1 = full size, 0 = shrunk. Starts full so people see where navigation lives.
  const [open, setOpen] = useState(true);
  const openAnim = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = (ms: number) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOpen(false), ms);
  };

  useEffect(() => {
    // Layout properties (width/height) animate on the JS thread, so useNativeDriver is off.
    Animated.timing(openAnim, {
      toValue: open ? 1 : 0,
      duration: open ? 300 : 360,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [open]);

  // First launch: show the full bar briefly, then shrink it.
  useEffect(() => {
    scheduleHide(ON_LAUNCH_MS);
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []);

  useEffect(() => {
    const idx = state.index;
    if (idx === prevIndex.current) return;
    // gentle bounce on the newly selected tab's icon
    Animated.sequence([
      Animated.spring(scales[idx], { toValue: 1.18, damping: 8, stiffness: 340, useNativeDriver: false }),
      Animated.spring(scales[idx], { toValue: 1,   damping: 14, stiffness: 240, useNativeDriver: false }),
    ]).start();
    prevIndex.current = idx;
  }, [state.index]);

  const dockBg     = isDark ? 'rgba(18,18,18,0.97)'   : 'rgba(255,255,255,0.97)';
  const dockBorder = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)';
  const activeText = colors.teal;
  const mutedText  = isDark ? 'rgba(232,228,220,0.38)' : 'rgba(0,0,0,0.32)';
  const shadowColor = isDark ? '#000' : '#085041';

  const dockBottom = tabBarBottomOffset(insets.bottom);
  // The bar floats over the screens; they add bottom padding via useTabBarSpace().
  const areaH = TAB_BAR_GAP + MINI_H + dockBottom;

  const fullW = screenW - DOCK_H_SIDE * 2;
  const miniW = fullW * MINI_WIDTH;

  const barWidth  = openAnim.interpolate({ inputRange: [0, 1], outputRange: [miniW, fullW] });
  const barHeight = openAnim.interpolate({ inputRange: [0, 1], outputRange: [MINI_H, DOCK_H] });
  const radius    = openAnim.interpolate({ inputRange: [0, 1], outputRange: [MINI_H / 2, 24] });
  const iconScale = openAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  // Labels fade out first when shrinking and fade in last when growing.
  const labelOpacity = openAnim.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] });
  const labelHeight  = openAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 15] });

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: areaH }} pointerEvents="box-none">
      {/* Content scrolling down behind the bar dissolves into the background */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: areaH + BOTTOM_FADE_H,
          experimental_backgroundImage: bottomFadeGradient(colors.bg),
        }}
      />

      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: dockBottom, alignItems: 'center' }}>
        <Animated.View
          style={{
            width: barWidth,
            height: barHeight,
            borderRadius: radius,
            paddingHorizontal: 4,
            backgroundColor: dockBg,
            borderWidth: 1,
            borderColor: dockBorder,
            flexDirection: 'row',
            alignItems: 'center',
            shadowColor, shadowOffset: { width: 0, height: 8 },
            shadowOpacity: isDark ? 0.22 : 0.13, shadowRadius: 22, elevation: 16,
          }}
        >
          {TABS.map((tab, i) => {
            const route = state.routes.find(r => r.name === tab.name);
            const isFocused = state.index === state.routes.indexOf(route!);

            const onPress = () => {
              if (!route) return;
              // Small bar: the first tap just grows it back to full size.
              if (!open) {
                Haptics.selectionAsync();
                setOpen(true);
                scheduleHide(AUTO_HIDE_MS);
                return;
              }
              Haptics.selectionAsync();
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              // Shrink again once they've picked where to go.
              scheduleHide(isFocused ? 0 : AFTER_SWITCH_MS);
            };

            return (
              <TouchableOpacity
                key={tab.name}
                onPress={onPress}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={open ? tab.label : 'Show navigation'}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 }}
              >
                <Animated.View
                  style={{
                    height: 26,
                    justifyContent: 'center',
                    transform: [{ scale: Animated.multiply(scales[i], iconScale) }],
                  }}
                >
                  <Ionicons
                    name={isFocused ? tab.iconOn : tab.icon}
                    size={19}
                    color={isFocused ? activeText : mutedText}
                  />
                </Animated.View>

                {/* Label — green + bold shows which screen you're on; hidden on the small bar */}
                <Animated.View style={{ height: labelHeight, opacity: labelOpacity, overflow: 'hidden', justifyContent: 'flex-end' }}>
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: isFocused ? '700' : '500',
                      letterSpacing: 0.1,
                      color: isFocused ? activeText : mutedText,
                    }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    {tab.label}
                  </Text>
                </Animated.View>
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      </View>
    </View>
  );
}

export default function TabLayout() {
  const { colors } = useTheme();
  const { isPremium } = useSubscription();

  return (
    <>
    <PendingInvitePrompt />
    <Tabs
      tabBar={(props) => <FloatingDock {...props} />}
      sceneContainerStyle={{ backgroundColor: colors.bg }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor:   colors.teal,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen name="index"       options={{ title: 'Inventory'   }} />
      <Tabs.Screen name="goodbot"     options={{ title: 'Good Bot'    }} />
      <Tabs.Screen name="collections" options={{ title: 'Recipes'     }} />
      <Tabs.Screen name="shopping"    options={{ title: 'Shopping'    }} />
      <Tabs.Screen name="foodreport"  options={{ title: 'Food Report' }} />
      <Tabs.Screen name="household"   options={{ title: 'Household'   }} />
    </Tabs>
    </>
  );
}
