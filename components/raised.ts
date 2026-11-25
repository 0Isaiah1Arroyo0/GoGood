import type { ViewStyle } from 'react-native';

// Shared "raised" button look: a soft drop shadow, a slightly darker bottom edge and a
// faint light top edge, so buttons read as physical keys instead of flat outlines.
// The edges are semi-transparent, so they work on any background color — gray, green,
// or a highlighted selection color.

/** Depth for any button. Keep the button's own backgroundColor. */
export function raised(isDark: boolean, size: 'sm' | 'md' = 'sm'): ViewStyle {
  const lift = size === 'md' ? 3 : 2;
  return {
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
    borderTopColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.7)',
    borderBottomWidth: 1.5,
    borderBottomColor: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.055)',
    shadowColor: isDark ? '#000' : '#3A2E1E', // warm shadow on the cream background
    shadowOffset: { width: 0, height: lift },
    shadowOpacity: isDark ? 0.4 : 0.07,
    shadowRadius: isDark ? lift + 5 : lift + 8, // wide and soft so it blends into the background
    elevation: lift,
  };
}

/** Depth plus a top-lit gradient, for buttons that are always the primary green. */
export function raisedGreen(isDark: boolean, size: 'sm' | 'md' = 'md'): ViewStyle {
  const lift = size === 'md' ? 4 : 3;
  return {
    ...raised(isDark, size),
    borderTopColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.12)',
    borderBottomColor: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,40,25,0.16)',
    shadowColor: isDark ? '#000' : '#085041',
    shadowOffset: { width: 0, height: lift },
    shadowOpacity: isDark ? 0.45 : 0.15,
    shadowRadius: isDark ? lift + 6 : lift + 9,
    elevation: lift,
    experimental_backgroundImage: isDark
      ? 'linear-gradient(180deg, #5A8169 0%, #4A705A 100%)'
      : 'linear-gradient(180deg, #12865F 0%, #0E7250 100%)',
  };
}
