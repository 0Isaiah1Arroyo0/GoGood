import {
  View, Text, Modal, StyleSheet, ScrollView,
  TouchableOpacity, TextInput, Animated, ActivityIndicator,
} from 'react-native';
import { useRef, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ThemeColors } from '../context/theme';
import {
  parseIngredients, matchIngredients, applyPortionDeductions,
  type IngredientMatch,
} from '../lib/recipe-inventory';

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  recipeContent: string;
  userId?: string;
  householdId?: string | null;
  colors: ThemeColors;
}

const fmtQty = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1));

export function PortionDeductionSheet({
  visible, onClose, onConfirm, recipeContent, userId, householdId, colors,
}: Props) {
  const slideAnim    = useRef(new Animated.Value(700)).current;
  const fadeAnim     = useRef(new Animated.Value(0)).current;
  const [mounted,      setMounted]      = useState(false);
  const [matches,      setMatches]      = useState<IngredientMatch[]>([]);
  const [enabled,      setEnabled]      = useState<Set<number>>(new Set());
  const [amounts,      setAmounts]      = useState<Record<number, string>>({});
  const [confirming,   setConfirming]   = useState(false);
  const [noInventory,  setNoInventory]  = useState(false);

  useEffect(() => {
    if (!visible) {
      if (mounted) {
        Animated.parallel([
          Animated.timing(fadeAnim,  { toValue: 0, duration: 240, useNativeDriver: true }),
          Animated.timing(slideAnim, { toValue: 700, duration: 260, useNativeDriver: true }),
        ]).start(() => setMounted(false));
      }
      return;
    }

    setMounted(true);
    setConfirming(false);
    slideAnim.setValue(700);
    fadeAnim.setValue(0);
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, damping: 36, stiffness: 130, useNativeDriver: true }),
    ]).start();

    AsyncStorage.getItem('gogood_items').then(raw => {
      const items: any[] = raw ? JSON.parse(raw) : [];
      setNoInventory(items.length === 0);
      const refs = items.map(i => ({
        id:       i.id,
        baseName: i.baseName || i.name || 'Item',
        qtyNum:   i.qtyNum ?? 1,
        unit:     i.unit ?? '',
        icon:     i.icon,
      }));
      const ingredients = parseIngredients(recipeContent);
      const matched     = matchIngredients(ingredients, refs);
      setMatches(matched);
      setEnabled(new Set(matched.map(m => m.item.id)));
      const initAmounts: Record<number, string> = {};
      for (const m of matched) initAmounts[m.item.id] = fmtQty(m.deductAmount);
      setAmounts(initAmounts);
    });
  }, [visible]);

  if (!mounted) return null;

  const toggleItem = (id: number) =>
    setEnabled(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const activeDeductions = [...enabled]
    .map(id => ({ itemId: id, amount: parseFloat(amounts[id] ?? '0') || 0 }))
    .filter(d => d.amount > 0);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      if (activeDeductions.length > 0) {
        await applyPortionDeductions(activeDeductions, userId, householdId ?? undefined);
      }
      onConfirm();
    } finally {
      setConfirming(false);
    }
  };

  const teal = colors.teal;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: fadeAnim }]}
          pointerEvents="none"
        />
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />

        <Animated.View style={{
          backgroundColor: colors.bg,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          maxHeight: '85%',
          transform: [{ translateY: slideAnim }],
        }}>
          {/* Handle */}
          <View style={{
            width: 36, height: 4, backgroundColor: 'rgba(0,0,0,0.1)',
            borderRadius: 999, alignSelf: 'center', marginTop: 12, marginBottom: 4,
          }} />

          {/* Header */}
          <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10 }}>
            <Text style={{
              fontSize: 18, fontWeight: '700', color: colors.brand,
              fontFamily: 'Fraunces_600SemiBold',
            }}>
              🍳 Update your inventory
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
              {matches.length > 0
                ? 'Matched ingredients from the recipe — adjust amounts then confirm.'
                : 'No ingredients could be matched to your current inventory.'}
            </Text>
          </View>

          {/* Content */}
          {noInventory ? (
            <View style={{ alignItems: 'center', padding: 36, gap: 10 }}>
              <Text style={{ fontSize: 36 }}>🛒</Text>
              <Text style={{ fontSize: 14, color: colors.textSub, textAlign: 'center', lineHeight: 20 }}>
                Your inventory is empty.{'\n'}Add items on the Home tab first.
              </Text>
            </View>
          ) : matches.length === 0 ? (
            <View style={{ alignItems: 'center', padding: 36, gap: 10 }}>
              <Text style={{ fontSize: 36 }}>🔍</Text>
              <Text style={{ fontSize: 14, color: colors.textSub, textAlign: 'center', lineHeight: 20 }}>
                No recipe ingredients matched{'\n'}items in your inventory.
              </Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {matches.map(m => {
                const isOn      = enabled.has(m.item.id);
                const rawAmt    = amounts[m.item.id] ?? '';
                const amt       = parseFloat(rawAmt) || 0;
                const remaining = m.item.qtyNum - amt;

                return (
                  <View key={m.item.id} style={{
                    paddingVertical: 12,
                    borderBottomWidth: 0.5, borderBottomColor: colors.border,
                    opacity: isOn ? 1 : 0.42,
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      {/* Checkbox */}
                      <TouchableOpacity
                        onPress={() => toggleItem(m.item.id)}
                        style={{
                          width: 22, height: 22, borderRadius: 6,
                          borderWidth: 1.5,
                          borderColor: isOn ? teal : colors.border,
                          backgroundColor: isOn ? teal : 'transparent',
                          alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        {isOn && (
                          <Text style={{ fontSize: 12, color: 'white', fontWeight: '800', lineHeight: 16 }}>
                            ✓
                          </Text>
                        )}
                      </TouchableOpacity>

                      {/* Icon + name */}
                      <Text style={{ fontSize: 20 }}>{m.item.icon || '🥘'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>
                          {m.item.baseName}
                        </Text>
                        <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
                          Have: {fmtQty(m.item.qtyNum)}{m.item.unit ? ` ${m.item.unit}` : ''}
                        </Text>
                      </View>

                      {/* Amount input + unit */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <TextInput
                          value={rawAmt}
                          onChangeText={v => setAmounts(prev => ({ ...prev, [m.item.id]: v }))}
                          keyboardType="decimal-pad"
                          editable={isOn}
                          style={{
                            width: 52, textAlign: 'center',
                            paddingHorizontal: 6, paddingVertical: 6,
                            fontSize: 14, fontWeight: '600', color: colors.text,
                            backgroundColor: colors.inputBg,
                            borderRadius: 8, borderWidth: 1, borderColor: colors.border,
                          }}
                        />
                        {m.item.unit ? (
                          <Text style={{ fontSize: 12, color: colors.textMuted, minWidth: 28 }}>
                            {m.item.unit}
                          </Text>
                        ) : null}
                      </View>
                    </View>

                    {/* Live remaining preview */}
                    {isOn && rawAmt !== '' && (
                      <Text style={{
                        fontSize: 11,
                        color: remaining <= 0 ? '#E05252' : teal,
                        marginTop: 6, marginLeft: 32,
                      }}>
                        {remaining <= 0
                          ? '→ Fully used up — will be marked gone good 🌱'
                          : `→ ${fmtQty(remaining)}${m.item.unit ? ` ${m.item.unit}` : ''} remaining`}
                      </Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}

          {/* Footer */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 0.5, borderTopColor: colors.border }}>
            <TouchableOpacity
              style={{
                backgroundColor: colors.btnPrimary, borderRadius: 14, paddingVertical: 14,
                alignItems: 'center', opacity: confirming ? 0.7 : 1,
              }}
              onPress={handleConfirm}
              disabled={confirming}
            >
              {confirming ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>
                  {activeDeductions.length > 0
                    ? `Confirm & update inventory (${activeDeductions.length} item${activeDeductions.length !== 1 ? 's' : ''})`
                    : 'Done — nothing to update'}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 10 }} onPress={onClose}>
              <Text style={{ fontSize: 14, color: colors.textMuted }}>cancel</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
