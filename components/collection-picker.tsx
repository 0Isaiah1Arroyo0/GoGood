import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme, type ThemeColors } from '@/app/context/theme';
import type { Collection } from '@/app/lib/collections';
import FoodIcon from '@/components/food-icon';
import BottomSheet from '@/components/bottom-sheet';
import { raised, raisedGreen } from '@/components/raised';

// The "Save recipe" sheet: pick a category or make a new one. Used by recipe import
// and Good Bot so saving looks the same everywhere.
const PICKER_EMOJIS = ['🍳','🥗','🍝','🥘','🥩','🍗','🐟','🥕','🌮','🍚','🍕','🥐','🍎','🧁','🍦','☕']; // shown as line icons

export default function CollectionPicker({ visible, collections, onSelect, onCreateAndSelect, onClose, colors: colorsProp, title }: {
  visible: boolean;
  collections: Collection[];
  onSelect: (id: string) => void;
  onCreateAndSelect: (name: string, emoji: string) => void;
  onClose: () => void;
  colors?: ThemeColors;
  title?: string;    // the recipe being saved, shown under the heading
}) {
  const { colors: themeColors, isDark } = useTheme();
  const colors = colorsProp ?? themeColors;
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState('');
  const [newEmoji, setNewEmoji] = useState(PICKER_EMOJIS[0]);

  useEffect(() => {
    if (visible) { setCreating(false); setNewName(''); setNewEmoji(PICKER_EMOJIS[0]); }
  }, [visible]);

  const options = [{ id: '', name: 'Uncategorized', emoji: '🍽️' }, ...collections];

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {creating ? (
        <>
          <TouchableOpacity onPress={() => setCreating(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={16} color={colors.textSub} />
            <Text style={{ fontSize: 13, color: colors.textSub, fontWeight: '600' }}>Back</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 20, color: colors.text, fontFamily: 'Fraunces_600SemiBold', marginBottom: 14 }}>New category</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {PICKER_EMOJIS.map(e => {
              const on = newEmoji === e;
              return (
                <TouchableOpacity
                  key={e} onPress={() => setNewEmoji(e)} activeOpacity={0.8}
                  style={[{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.chipBg : colors.surface }, raised(isDark)]}
                >
                  <FoodIcon emoji={e} size={22} bare color={on ? colors.chipText : colors.textSub} />
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={{ backgroundColor: colors.inputBg, borderRadius: 12, borderWidth: 1, borderColor: colors.inputBorder, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: colors.inputText, marginBottom: 14 }}
            placeholder="Category name, e.g. Quick weeknights"
            placeholderTextColor={colors.placeholder}
            keyboardAppearance={isDark ? 'dark' : 'light'}
            value={newName}
            onChangeText={setNewName}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => newName.trim() && onCreateAndSelect(newName.trim(), newEmoji)}
          />
          <TouchableOpacity
            style={[{ backgroundColor: colors.btnPrimary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', opacity: newName.trim() ? 1 : 0.45 }, raisedGreen(isDark)]}
            disabled={!newName.trim()}
            onPress={() => onCreateAndSelect(newName.trim(), newEmoji)}
            activeOpacity={0.85}
          >
            <Text style={{ color: colors.btnPrimaryText, fontWeight: '700', fontSize: 15 }}>Create and save</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 20, color: colors.text, fontFamily: 'Fraunces_600SemiBold', marginBottom: 14 }}>Save recipe</Text>
          {title ? <Text style={{ fontSize: 13, color: colors.textSub, marginTop: -8, marginBottom: 14 }} numberOfLines={2}>{title}</Text> : null}
          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
          <View style={[{ backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden' }, raised(isDark, 'md')]}>
            {options.map((col, i) => (
              <TouchableOpacity
                key={col.id || 'uncategorized'}
                onPress={() => onSelect(col.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, borderTopWidth: i ? 0.5 : 0, borderTopColor: colors.border }}
                activeOpacity={0.7}
              >
                <FoodIcon emoji={col.emoji} size={34} />
                <Text style={{ fontSize: 15, fontWeight: '500', color: colors.text, flex: 1 }}>{col.name}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
          </ScrollView>
          <TouchableOpacity
            onPress={() => setCreating(true)}
            style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, paddingVertical: 13, borderRadius: 14, backgroundColor: colors.surfaceAlt }, raised(isDark)]}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={18} color={colors.text} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>New category</Text>
          </TouchableOpacity>
        </>
      )}
    </BottomSheet>
  );
}
