import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textSub: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  brand: string;
  teal: string;
  tealLight: string;
  statusBar: 'light' | 'dark';
  tabBarBg: string;
  inputBg: string;
  inputBorder: string;
  inputText: string;
  placeholder: string;
  drawerBg: string;
  chatInputBg: string;
  onlineDotBorder: string;
}

export const LIGHT: ThemeColors = {
  bg:              '#FAF8F3',
  surface:         '#FFFFFF',
  surfaceAlt:      '#F4F2ED',
  text:            '#1C1C1E',
  textSub:         '#6B6860',
  textMuted:       '#aaa',
  border:          'rgba(0,0,0,0.07)',
  borderStrong:    'rgba(0,0,0,0.12)',
  brand:           '#085041',
  teal:            '#1D9E75',
  tealLight:       '#5DCAA5',
  statusBar:       'dark',
  tabBarBg:        '#FFFFFF',
  inputBg:         '#FFFFFF',
  inputBorder:     'rgba(0,0,0,0.1)',
  inputText:       '#2C1810',
  placeholder:     '#bbb',
  drawerBg:        '#FFFFFF',
  chatInputBg:     '#EFECE6',
  onlineDotBorder: '#FAF8F3',
};

export const DARK: ThemeColors = {
  bg:              '#0E1B17',
  surface:         '#162922',
  surfaceAlt:      '#1C3530',
  text:            '#EEF9F5',
  textSub:         'rgba(238,249,245,0.55)',
  textMuted:       'rgba(238,249,245,0.3)',
  border:          'rgba(255,255,255,0.08)',
  borderStrong:    'rgba(255,255,255,0.14)',
  brand:           '#085041',
  teal:            '#1D9E75',
  tealLight:       '#5DCAA5',
  statusBar:       'light',
  tabBarBg:        '#0A1F1A',
  inputBg:         'rgba(255,255,255,0.1)',
  inputBorder:     'rgba(255,255,255,0.15)',
  inputText:       '#EEF9F5',
  placeholder:     'rgba(238,249,245,0.35)',
  drawerBg:        '#162922',
  chatInputBg:     '#1C3530',
  onlineDotBorder: '#0E1B17',
};

interface ThemeCtx {
  colors: ThemeColors;
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeCtx>({ colors: LIGHT, isDark: false, toggleTheme: () => {} });

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('gogood_theme').then(v => {
      if (v === 'dark') setIsDark(true);
    });
  }, []);

  const toggleTheme = () => {
    setIsDark(prev => {
      const next = !prev;
      AsyncStorage.setItem('gogood_theme', next ? 'dark' : 'light');
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ colors: isDark ? DARK : LIGHT, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
