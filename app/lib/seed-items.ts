import AsyncStorage from '@react-native-async-storage/async-storage';

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function getBadge(days: number, cat: string) {
  if (days < 0)          return 'black';
  if (cat === 'freezer') return 'blue';
  if (days === 0)        return 'red';
  if (days <= 5)         return 'amber';
  return 'green';
}

function getExpiryText(days: number): string {
  if (days < 0)  return 'expired';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `${days} days`;
}

const SEED: Array<{
  id: number; icon: string; baseName: string; unit: string; qtyNum: number;
  expiryDays: number; protein: number; carbs: number; fat: number; cal: number;
  category: 'fridge' | 'freezer' | 'pantry'; foodCategory: string;
}> = [
  { id: 1001, icon: '🥛', baseName: 'Whole Milk',         unit: 'oz',  qtyNum: 32,  expiryDays: 4,   protein: 8,  carbs: 12,  fat: 8,  cal: 150, category: 'fridge',  foodCategory: 'Dairy' },
  { id: 1002, icon: '🥚', baseName: 'Large Eggs',         unit: 'ct',  qtyNum: 12,  expiryDays: 9,   protein: 6,  carbs: 1,   fat: 5,  cal: 70,  category: 'fridge',  foodCategory: 'Protein' },
  { id: 1003, icon: '🧀', baseName: 'Cheddar Cheese',     unit: 'oz',  qtyNum: 8,   expiryDays: 16,  protein: 7,  carbs: 0,   fat: 9,  cal: 110, category: 'fridge',  foodCategory: 'Dairy' },
  { id: 1004, icon: '🧈', baseName: 'Unsalted Butter',    unit: 'oz',  qtyNum: 16,  expiryDays: 42,  protein: 0,  carbs: 0,   fat: 11, cal: 100, category: 'fridge',  foodCategory: 'Dairy' },
  { id: 1005, icon: '🥛', baseName: 'Greek Yogurt',       unit: 'oz',  qtyNum: 32,  expiryDays: 2,   protein: 10, carbs: 7,   fat: 0,  cal: 60,  category: 'fridge',  foodCategory: 'Dairy' },
  { id: 1006, icon: '🍗', baseName: 'Chicken Breast',     unit: 'lbs', qtyNum: 2,   expiryDays: 1,   protein: 31, carbs: 0,   fat: 4,  cal: 165, category: 'fridge',  foodCategory: 'Protein' },
  { id: 1007, icon: '🥦', baseName: 'Broccoli',           unit: 'ct',  qtyNum: 1,   expiryDays: 2,   protein: 3,  carbs: 6,   fat: 0,  cal: 34,  category: 'fridge',  foodCategory: 'Vegetables' },
  { id: 1008, icon: '🥬', baseName: 'Spinach',            unit: 'oz',  qtyNum: 5,   expiryDays: 4,   protein: 3,  carbs: 4,   fat: 0,  cal: 23,  category: 'fridge',  foodCategory: 'Vegetables' },
  { id: 1009, icon: '🥕', baseName: 'Carrots',            unit: 'lbs', qtyNum: 2,   expiryDays: 15,  protein: 1,  carbs: 10,  fat: 0,  cal: 41,  category: 'fridge',  foodCategory: 'Vegetables' },
  { id: 1010, icon: '🧄', baseName: 'Garlic',             unit: 'ct',  qtyNum: 3,   expiryDays: 32,  protein: 0,  carbs: 1,   fat: 0,  cal: 5,   category: 'pantry',  foodCategory: 'Vegetables' },
  { id: 1011, icon: '🧅', baseName: 'Yellow Onion',       unit: 'ct',  qtyNum: 3,   expiryDays: 26,  protein: 1,  carbs: 11,  fat: 0,  cal: 44,  category: 'pantry',  foodCategory: 'Vegetables' },
  { id: 1012, icon: '🍅', baseName: 'Roma Tomatoes',      unit: 'ct',  qtyNum: 4,   expiryDays: 4,   protein: 1,  carbs: 5,   fat: 0,  cal: 22,  category: 'fridge',  foodCategory: 'Vegetables' },
  { id: 1013, icon: '🥩', baseName: 'Ground Beef',        unit: 'lbs', qtyNum: 1,   expiryDays: 63,  protein: 18, carbs: 0,   fat: 18, cal: 236, category: 'freezer', foodCategory: 'Protein' },
  { id: 1014, icon: '🐟', baseName: 'Salmon Fillet',      unit: 'oz',  qtyNum: 12,  expiryDays: 46,  protein: 25, carbs: 0,   fat: 13, cal: 208, category: 'freezer', foodCategory: 'Protein' },
  { id: 1015, icon: '🫙', baseName: 'Olive Oil',          unit: 'oz',  qtyNum: 16,  expiryDays: 185, protein: 0,  carbs: 0,   fat: 14, cal: 119, category: 'pantry',  foodCategory: 'Fats & Oils' },
  { id: 1016, icon: '🌾', baseName: 'All-Purpose Flour',  unit: 'lbs', qtyNum: 5,   expiryDays: 155, protein: 3,  carbs: 22,  fat: 0,  cal: 100, category: 'pantry',  foodCategory: 'Grains' },
  { id: 1017, icon: '🍚', baseName: 'White Rice',         unit: 'lbs', qtyNum: 2,   expiryDays: 169, protein: 2,  carbs: 28,  fat: 0,  cal: 130, category: 'pantry',  foodCategory: 'Grains' },
  { id: 1018, icon: '🫘', baseName: 'Black Beans',        unit: 'oz',  qtyNum: 15,  expiryDays: 564, protein: 7,  carbs: 20,  fat: 0,  cal: 110, category: 'pantry',  foodCategory: 'Protein' },
  { id: 1019, icon: '🍝', baseName: 'Spaghetti',          unit: 'oz',  qtyNum: 16,  expiryDays: 185, protein: 8,  carbs: 43,  fat: 1,  cal: 200, category: 'pantry',  foodCategory: 'Grains' },
  { id: 1020, icon: '🫙', baseName: 'Chicken Broth',      unit: 'oz',  qtyNum: 32,  expiryDays: 108, protein: 1,  carbs: 1,   fat: 0,  cal: 10,  category: 'pantry',  foodCategory: 'Other' },
  { id: 1021, icon: '🥛', baseName: 'Heavy Cream',        unit: 'oz',  qtyNum: 16,  expiryDays: 6,   protein: 0,  carbs: 1,   fat: 11, cal: 101, category: 'fridge',  foodCategory: 'Dairy' },
  { id: 1022, icon: '🧀', baseName: 'Parmesan Cheese',    unit: 'oz',  qtyNum: 4,   expiryDays: 32,  protein: 4,  carbs: 0,   fat: 7,  cal: 80,  category: 'fridge',  foodCategory: 'Dairy' },
  { id: 1023, icon: '🫑', baseName: 'Bell Pepper',        unit: 'ct',  qtyNum: 3,   expiryDays: 5,   protein: 1,  carbs: 7,   fat: 0,  cal: 31,  category: 'fridge',  foodCategory: 'Vegetables' },
  { id: 1024, icon: '🥑', baseName: 'Avocado',            unit: 'ct',  qtyNum: 2,   expiryDays: 2,   protein: 2,  carbs: 9,   fat: 15, cal: 160, category: 'fridge',  foodCategory: 'Vegetables' },
  { id: 1025, icon: '🍋', baseName: 'Lemons',             unit: 'ct',  qtyNum: 6,   expiryDays: 13,  protein: 0,  carbs: 5,   fat: 0,  cal: 17,  category: 'fridge',  foodCategory: 'Fruits' },
];

export async function seedSampleItems(): Promise<void> {
  const now = Date.now();
  const items = SEED.map(s => {
    const days    = s.expiryDays;
    const expDate = daysFromNow(days);
    const qty     = `${s.qtyNum} ${s.unit}`.trim();
    return {
      id:           s.id,
      icon:         s.icon,
      name:         s.baseName,
      baseName:     s.baseName,
      batch:        1,
      qty,
      expiryDate:   expDate,
      expires:      getExpiryText(days),
      badge:        getBadge(days, s.category),
      days,
      protein:      s.protein,
      carbs:        s.carbs,
      fat:          s.fat,
      cal:          s.cal,
      qtyNum:       s.qtyNum,
      unit:         s.unit,
      category:     s.category,
      addedAt:      now,
      foodCategory: s.foodCategory,
    };
  });

  const existing = await AsyncStorage.getItem('gogood_items');
  const current: any[] = existing ? JSON.parse(existing) : [];
  // Merge: keep existing items, skip seed IDs already present
  const existingIds = new Set(current.map((i: any) => i.id));
  const toAdd = items.filter(i => !existingIds.has(i.id));
  await AsyncStorage.setItem('gogood_items', JSON.stringify([...current, ...toAdd]));
}

export async function clearSampleItems(): Promise<void> {
  const seedIds = new Set(SEED.map(s => s.id));
  const existing = await AsyncStorage.getItem('gogood_items');
  const current: any[] = existing ? JSON.parse(existing) : [];
  await AsyncStorage.setItem(
    'gogood_items',
    JSON.stringify(current.filter((i: any) => !seedIds.has(i.id))),
  );
}
