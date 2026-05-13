import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useTheme } from '../context/theme';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;
}

export default function TabLayout() {
  const { colors, isDark } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.tabBarBg,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
          height: 85,
          paddingBottom: 20,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: isDark ? 'rgba(255,255,255,0.45)' : colors.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Inventory', tabBarIcon: ({ focused }) => <TabIcon emoji="🥗" focused={focused} /> }} />
      <Tabs.Screen name="goodbot" options={{ title: 'Good Bot', tabBarIcon: ({ focused }) => <TabIcon emoji="🤖" focused={focused} /> }} />
      <Tabs.Screen name="foodreport" options={{ title: 'Food Report', tabBarIcon: ({ focused }) => <TabIcon emoji="📊" focused={focused} /> }} />
    </Tabs>
  );
}
