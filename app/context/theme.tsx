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
  btnPrimary: string;
  btnPrimaryText: string;
  chipBg: string;
  chipText: string;
  goneGoodBg: string;
  goneGoodText: string;
  goneBadBg: string;
  goneBadText: string;
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
  brand:           '#0F7855',
  teal:            '#23B385',
  tealLight:       '#6DD4B0',
  statusBar:       'dark',
  tabBarBg:        '#FFFFFF',
  inputBg:         '#FFFFFF',
  inputBorder:     'rgba(0,0,0,0.1)',
  inputText:       '#2C1810',
  placeholder:     '#bbb',
  drawerBg:        '#FFFFFF',
  chatInputBg:     '#EFECE6',
  onlineDotBorder: '#FAF8F3',
  btnPrimary:      '#0F7855',
  btnPrimaryText:  '#FFFFFF',
  chipBg:          '#E8F5F0',
  chipText:        '#0F7855',
  goneGoodBg:      '#E1F5EE',
  goneGoodText:    '#0F7855',
  goneBadBg:       '#FEEBEB',
  goneBadText:     '#A52020',
};

export const DARK: ThemeColors = {
  bg:              '#141414',
  surface:         '#1E1E1E',
  surfaceAlt:      '#262626',
  text:            '#E8E4DC',
  textSub:         'rgba(232,228,220,0.62)',
  textMuted:       'rgba(232,228,220,0.36)',
  border:          'rgba(255,255,255,0.08)',
  borderStrong:    'rgba(255,255,255,0.16)',
  brand:           '#E8E4DC',
  teal:            '#4F7861',
  tealLight:       '#6B9878',
  statusBar:       'light',
  tabBarBg:        '#0E0E0E',
  inputBg:         'rgba(255,255,255,0.08)',
  inputBorder:     'rgba(255,255,255,0.14)',
  inputText:       '#E8E4DC',
  placeholder:     'rgba(232,228,220,0.36)',
  drawerBg:        '#1E1E1E',
  chatInputBg:     '#262626',
  onlineDotBorder: '#141414',
  btnPrimary:      '#4F7861',
  btnPrimaryText:  '#E8E4DC',
  chipBg:          'rgba(79,120,97,0.16)',
  chipText:        '#E8E4DC',
  goneGoodBg:      'rgba(79,120,97,0.18)',
  goneGoodText:    '#4F7861',
  goneBadBg:       'rgba(240,100,80,0.18)',
  goneBadText:     '#F5A090',
};

interface ThemeCtx {
  colors: ThemeColors;
  isDark: boolean;
  toggleTheme: () => void;
  listDensity: 'compact';
}

const ThemeContext = createContext<ThemeCtx>({ colors: LIGHT, isDark: false, toggleTheme: () => {}, listDensity: 'compact' });

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('gogood_theme').then(v => { if (v === 'dark') setIsDark(true); });
  }, []);

  const toggleTheme = () => {
    setIsDark(prev => {
      const next = !prev;
      AsyncStorage.setItem('gogood_theme', next ? 'dark' : 'light');
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ colors: isDark ? DARK : LIGHT, isDark, toggleTheme, listDensity: 'compact' }}>
      {children}
    </ThemeContext.Provider>
  );
}
