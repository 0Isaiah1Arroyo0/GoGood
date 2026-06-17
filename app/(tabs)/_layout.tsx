import { Tabs } from 'expo-router';
import { Text, View, TouchableOpacity, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRef, useEffect } from 'react';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/theme';
import { useSubscription } from '../context/subscription';

const TABS = [
  { name: 'index',       emoji: '🥗', label: 'Inventory' },
  { name: 'goodbot',     emoji: '🤖', label: 'Good Bot'  },
  { name: 'collections', emoji: '📚', label: 'Recipes'   },
  { name: 'shopping',    emoji: '🛒', label: 'Shop'      },
  { name: 'foodreport',  emoji: '📊', label: 'Report'    },
  { name: 'household',   emoji: '🏠', label: 'Household' },
];

const DOCK_H      = 58;
const DOCK_BOTTOM = 16;
const DOCK_TOP    = 10;
const DOCK_H_SIDE = 20;

function FloatingDock({ state, navigation }: BottomTabBarProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const scales = useRef(TABS.map(() => new Animated.Value(1))).current;
  // initialise the starting tab's glow to 1 so the pill shows on first render
  const glows  = useRef(TABS.map((_, i) => new Animated.Value(i === state.index ? 1 : 0))).current;
  const prevIndex = useRef(state.index);

  useEffect(() => {
    const idx = state.index;
    if (idx === prevIndex.current) return;

    const prev = prevIndex.current;

    // fade out the old tab's pill
    Animated.timing(glows[prev], { toValue: 0, duration: 160, useNativeDriver: true }).start();

    // bounce the newly selected tab
    Animated.sequence([
      Animated.spring(scales[idx], { toValue: 1.2, damping: 8, stiffness: 340, useNativeDriver: true }),
      Animated.spring(scales[idx], { toValue: 1,   damping: 14, stiffness: 240, useNativeDriver: true }),
    ]).start();

    // fade in new tab's pill
    glows[idx].setValue(0);
    Animated.timing(glows[idx], { toValue: 1, duration: 180, useNativeDriver: true }).start();

    prevIndex.current = idx;
  }, [state.index]);

  const dockBg     = isDark ? 'rgba(18,18,18,0.97)'   : 'rgba(255,255,255,0.97)';
  const dockBorder = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)';
  const activeText = colors.teal;
  const mutedText  = isDark ? 'rgba(232,228,220,0.38)' : 'rgba(0,0,0,0.32)';
  const activePill = isDark ? 'rgba(141,184,154,0.22)' : 'rgba(29,158,117,0.13)';
  const shadowColor = isDark ? '#000' : '#085041';

  const spacerH = DOCK_TOP + DOCK_H + DOCK_BOTTOM + Math.max(insets.bottom, 10);

  return (
    <View style={{ height: spacerH, backgroundColor: colors.bg }} pointerEvents="box-none">
      <View
        style={{
          position: 'absolute',
          bottom: Math.max(insets.bottom, 10) + DOCK_BOTTOM,
          left: DOCK_H_SIDE,
          right: DOCK_H_SIDE,
          height: DOCK_H,
          borderRadius: DOCK_H / 2,
          backgroundColor: dockBg,
          borderWidth: 1,
          borderColor: dockBorder,
          flexDirection: 'row',
          alignItems: 'center',
          // iOS shadow
          shadowColor,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: isDark ? 0.22 : 0.13,
          shadowRadius: 22,
          // Android elevation
          elevation: 16,
        }}
      >
        {TABS.map((tab, i) => {
          const route = state.routes.find(r => r.name === tab.name);
          const isFocused = state.index === state.routes.indexOf(route!);

          const onPress = () => {
            if (!route) return;
            Haptics.selectionAsync();
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <TouchableOpacity
              key={tab.name}
              onPress={onPress}
              activeOpacity={0.8}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 8,
              }}
            >
              {/* Active pill — opacity driven purely by animated value */}
              <Animated.View
                style={{
                  position: 'absolute',
                  top: 6, left: 4, right: 4, bottom: 6,
                  borderRadius: 18,
                  backgroundColor: activePill,
                  opacity: glows[i],
                }}
              />

              {/* Icon */}
              <Animated.Text
                style={{
                  fontSize: 20,
                  transform: [{ scale: scales[i] }],
                  opacity: isFocused ? 1 : 0.45,
                }}
              >
                {tab.emoji}
              </Animated.Text>

              {/* Label */}
              <Text
                style={{
                  fontSize: 7,
                  fontWeight: isFocused ? '700' : '500',
                  marginTop: 2,
                  letterSpacing: 0.1,
                  color: isFocused ? activeText : mutedText,
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function TabLayout() {
  const { colors } = useTheme();
  const { isPremium } = useSubscription();

  return (
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
  );
}
