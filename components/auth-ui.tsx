import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme, type ThemeColors } from '@/app/context/theme';
import { raised, raisedGreen } from '@/components/raised';

// Shared look for the sign-in screens (welcome, login, sign up, Face ID, reset,
// confirm), so they use the same colors, inputs and raised buttons as the app.

export function useAuthStyles() {
  const { colors: c, isDark } = useTheme();
  const styles = useMemo(() => createAuthStyles(c, isDark), [c, isDark]);
  // Links and highlights: dark green on light, soft green on dark
  const link = isDark ? c.tealLight : c.brand;
  return { styles, c, isDark, link };
}

/** A round icon in a soft green (or red) circle, used instead of emojis. */
export function IconBadge({ name, size = 56, tone = 'good' }: {
  name: keyof typeof Ionicons.glyphMap;
  size?: number;
  tone?: 'good' | 'bad';
}) {
  const { colors: c } = useTheme();
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: tone === 'bad' ? c.goneBadBg : c.chipBg,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Ionicons name={name} size={Math.round(size * 0.46)} color={tone === 'bad' ? c.goneBadText : c.chipText} />
    </View>
  );
}

/** Raised round back button for the screen header. */
export function BackButton({ onPress }: { onPress: () => void }) {
  const { colors: c, isDark } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }, raised(isDark)]}
      accessibilityLabel="Back"
    >
      <Ionicons name="chevron-back" size={18} color={c.text} />
    </TouchableOpacity>
  );
}

function createAuthStyles(c: ThemeColors, isDark: boolean) {
  const link = isDark ? c.tealLight : c.brand;
  return StyleSheet.create({
    safeArea:       { flex: 1, backgroundColor: c.bg },
    header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
    headerTitle:    { fontSize: 16, fontWeight: '600', color: c.text },
    scroll:         { flex: 1, backgroundColor: c.bg },
    body:           { padding: 24, gap: 16, paddingBottom: 48 },
    logo:           { fontSize: 36, fontWeight: '700', color: c.brand, textAlign: 'center', fontFamily: 'Fraunces_600SemiBold' },
    logoGreen:      { color: c.teal, fontFamily: 'Fraunces_600SemiBold' },
    subtitle:       { fontSize: 14, color: c.textSub, textAlign: 'center', marginTop: -8 },

    card:           { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.surface, borderRadius: 16, padding: 16, ...raised(isDark, 'md') },
    cardTitle:      { fontSize: 15, fontWeight: '600', color: c.text },
    cardSub:        { fontSize: 12, color: c.textSub, marginTop: 2 },

    field:          { gap: 6 },
    fieldLabel:     { fontSize: 12, fontWeight: '600', color: c.textSub },
    input:          { backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: c.inputText },
    inputError:     { borderColor: '#E0574A' },
    errorText:      { fontSize: 12, color: '#E0574A', marginTop: 2 },
    matchText:      { fontSize: 12, color: link, marginTop: 4 },
    forgotText:     { fontSize: 13, color: link, fontWeight: '600' },
    eyeBtn:         { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
    eyeText:        { fontSize: 13, color: c.textSub, fontWeight: '600' },

    btnPrimary:     { backgroundColor: c.btnPrimary, paddingVertical: 15, borderRadius: 14, alignItems: 'center', justifyContent: 'center', minHeight: 52, ...raisedGreen(isDark) },
    btnPrimaryText: { color: 'white', fontSize: 15, fontWeight: '700' },
    btnSecondary:   { backgroundColor: c.surface, paddingVertical: 15, borderRadius: 14, alignItems: 'center', justifyContent: 'center', minHeight: 52, ...raised(isDark, 'md') },
    btnSecondaryText: { color: c.text, fontSize: 15, fontWeight: '600' },

    switchRow:      { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
    switchText:     { fontSize: 14, color: c.textSub },
    switchLink:     { fontSize: 14, color: link, fontWeight: '700' },
    terms:          { fontSize: 12, color: c.textMuted, textAlign: 'center', lineHeight: 18 },
    termsLink:      { color: link },

    // Centered message screens (check your inbox, link expired, ...)
    messageBox:     { gap: 14, alignItems: 'center' },
    messageTitle:   { fontSize: 22, fontWeight: '700', color: c.text, textAlign: 'center', fontFamily: 'Fraunces_600SemiBold' },
    messageText:    { fontSize: 14, color: c.textSub, textAlign: 'center', lineHeight: 22 },
    messageHint:    { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 20 },
  });
}
