import { StyleSheet, Text, View, ScrollView, TouchableOpacity, SafeAreaView, Animated, Modal, TextInput, KeyboardAvoidingView, Platform, Switch, Linking, Alert, Image, Dimensions, Easing, Keyboard } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme, type ThemeColors } from '../context/theme';
import { useAuth } from '../context/auth';

type Badge = 'red' | 'amber' | 'green' | 'blue' | 'black';
type Category = 'fridge' | 'freezer' | 'pantry';
type SortBy = 'expiry' | 'expiryAsc' | 'alpha' | 'alphaDesc' | 'protein' | 'proteinAsc' | 'cal' | 'calAsc' | 'recent' | 'oldest' | 'category';

interface Item {
  id: number; icon: string; name: string; baseName: string; batch: number;
  qty: string; expiryDate: string; expires: string; badge: Badge; days: number;
  protein: number; carbs: number; fat: number; cal: number;
  qtyNum: number; unit: string; category: Category; addedAt: number;
  foodCategory?: string;
}

const BADGE_SOFT: Record<Badge, { bg: string; text: string }> = {
  red:   { bg: '#FEEBEB', text: '#A52020' },
  amber: { bg: '#FFF8E6', text: '#7A4A00' },
  green: { bg: '#E1F5EE', text: '#0A5740' },
  blue:  { bg: '#EBF4FF', text: '#14428A' },
  black: { bg: '#2C2C2E', text: '#FFFFFF' },
};

const ICON_BG: Record<Badge, string> = {
  red:   '#FCEBEB',
  amber: '#FFF8E6',
  green: '#E1F5EE',
  blue:  '#E6F1FB',
  black: '#2C2C2E',
};

const FOOD_ICONS: Record<string, string> = {
  'ribeye': '🥩', 'rib eye': '🥩', 'steak': '🥩', 'beef': '🥩', 'brisket': '🥩',
  'ground beef': '🥩', 'hamburger': '🥩', 'burger': '🥩', 'veal': '🥩',
  'lamb': '🥩', 'venison': '🥩', 'bison': '🥩', 'meatball': '🥩',
  'pork': '🥓', 'bacon': '🥓', 'ham': '🥓', 'prosciutto': '🥓', 'sausage': '🌭',
  'hot dog': '🌭', 'chorizo': '🌭', 'salami': '🥓', 'pepperoni': '🍕',
  'chicken': '🍗', 'turkey': '🦃', 'duck': '🍗',
  'salmon': '🐟', 'tuna': '🐟', 'fish': '🐟', 'tilapia': '🐟', 'cod': '🐟',
  'halibut': '🐟', 'trout': '🐟', 'bass': '🐟', 'snapper': '🐟',
  'shrimp': '🦐', 'prawn': '🦐', 'lobster': '🦞', 'crab': '🦀',
  'scallop': '🐚', 'oyster': '🦪', 'clam': '🦪', 'mussel': '🦪',
  'squid': '🦑', 'octopus': '🐙',
  'egg': '🥚', 'eggs': '🥚',
  'milk': '🥛', 'oat milk': '🥛', 'almond milk': '🥛', 'soy milk': '🥛',
  'cream': '🥛', 'heavy cream': '🥛', 'half and half': '🥛', 'sour cream': '🥛',
  'cheese': '🧀', 'cheddar': '🧀', 'mozzarella': '🧀', 'parmesan': '🧀',
  'brie': '🧀', 'gouda': '🧀', 'feta': '🧀', 'ricotta': '🧀', 'cream cheese': '🧀',
  'butter': '🧈', 'ghee': '🧈', 'margarine': '🧈',
  'yogurt': '🥛', 'greek yogurt': '🥛', 'kefir': '🥛',
  'broccoli': '🥦', 'cauliflower': '🥦', 'brussels': '🥦',
  'spinach': '🥬', 'lettuce': '🥬', 'kale': '🥬', 'arugula': '🥬', 'cabbage': '🥬',
  'bok choy': '🥬', 'collard': '🥬', 'chard': '🥬',
  'carrot': '🥕', 'parsnip': '🥕',
  'tomato': '🍅', 'cherry tomato': '🍅',
  'onion': '🧅', 'shallot': '🧅', 'leek': '🧅',
  'garlic': '🧄',
  'sweet potato': '🍠', 'yam': '🍠', 'potato': '🥔',
  'bell pepper': '🫑', 'pepper': '🫑', 'jalapeño': '🌶️', 'chili': '🌶️',
  'corn': '🌽', 'cucumber': '🥒', 'zucchini': '🥒', 'squash': '🥒',
  'eggplant': '🍆', 'asparagus': '🌿', 'celery': '🌿', 'fennel': '🌿',
  'mushroom': '🍄', 'beet': '🥕', 'radish': '🥕', 'artichoke': '🌿',
  'avocado': '🥑', 'pea': '🫛', 'edamame': '🫛', 'green bean': '🫛',
  'apple': '🍎', 'red apple': '🍎', 'green apple': '🍏',
  'banana': '🍌', 'orange': '🍊', 'lemon': '🍋', 'lime': '🍋',
  'strawberry': '🍓', 'blueberry': '🫐', 'raspberry': '🫐', 'blackberry': '🫐',
  'grape': '🍇', 'watermelon': '🍉', 'cantaloupe': '🍈', 'honeydew': '🍈',
  'peach': '🍑', 'plum': '🍑', 'nectarine': '🍑', 'apricot': '🍑',
  'mango': '🥭', 'pineapple': '🍍', 'kiwi': '🥝', 'cherry': '🍒', 'pear': '🍐',
  'grapefruit': '🍊', 'pomegranate': '🍎',
  'bread': '🍞', 'sourdough': '🍞', 'baguette': '🥖', 'bagel': '🥯',
  'tortilla': '🫓', 'pita': '🫓', 'naan': '🫓', 'flatbread': '🫓',
  'pasta': '🍝', 'spaghetti': '🍝', 'penne': '🍝', 'fettuccine': '🍝',
  'noodle': '🍜', 'ramen': '🍜', 'udon': '🍜',
  'rice': '🍚', 'brown rice': '🍚', 'quinoa': '🍚',
  'oat': '🥣', 'oatmeal': '🥣', 'cereal': '🥣', 'granola': '🥣',
  'flour': '🫙', 'cornmeal': '🫙',
  'ketchup': '🫙', 'mustard': '🫙', 'mayo': '🫙', 'mayonnaise': '🫙',
  'salsa': '🫙', 'hummus': '🫙', 'ranch': '🫙', 'dressing': '🫙',
  'olive oil': '🫒', 'olive': '🫒', 'vinegar': '🫙', 'soy sauce': '🫙',
  'juice': '🧃', 'orange juice': '🧃', 'coffee': '☕', 'tea': '🍵',
  'kombucha': '🧃', 'smoothie': '🧃', 'wine': '🍷', 'beer': '🍺',
  'chocolate': '🍫', 'cookie': '🍪', 'cake': '🎂', 'pie': '🥧',
  'ice cream': '🍦', 'frozen': '🧊',
  'tofu': '🫙', 'tempeh': '🫙',
  'almond': '🥜', 'peanut butter': '🥜', 'peanut': '🥜', 'cashew': '🥜',
  'walnut': '🥜', 'nut': '🥜',
  'honey': '🍯', 'syrup': '🍯', 'jam': '🫙', 'jelly': '🫙',
  'salt': '🧂',
  'default': '🥗',
};

const FOOD_CATEGORIES: Record<string, string> = {
  // Meat — multi-word first so longest-match wins
  'ground beef': 'Meat', 'corned beef': 'Meat', 'short rib': 'Meat', 'rib eye': 'Meat',
  'hot dog': 'Meat', 'ribeye': 'Meat', 'steak': 'Meat', 'beef': 'Meat', 'brisket': 'Meat',
  'lamb': 'Meat', 'bison': 'Meat', 'veal': 'Meat', 'meatball': 'Meat', 'meatloaf': 'Meat',
  'pork': 'Meat', 'bacon': 'Meat', 'ham': 'Meat', 'sausage': 'Meat',
  'prosciutto': 'Meat', 'chorizo': 'Meat', 'salami': 'Meat', 'pepperoni': 'Meat',
  'bratwurst': 'Meat', 'liverwurst': 'Meat', 'mortadella': 'Meat',
  'pastrami': 'Meat', 'bologna': 'Meat', 'venison': 'Meat', 'ribs': 'Meat',
  'tenderloin': 'Meat', 'sirloin': 'Meat', 'chuck': 'Meat', 'flank': 'Meat',
  'burger': 'Meat', 'hamburger': 'Meat',
  // Poultry
  'chicken breast': 'Poultry', 'chicken thigh': 'Poultry', 'chicken wing': 'Poultry',
  'ground turkey': 'Poultry', 'turkey breast': 'Poultry', 'cornish hen': 'Poultry',
  'chicken': 'Poultry', 'turkey': 'Poultry', 'duck': 'Poultry', 'quail': 'Poultry', 'goose': 'Poultry',
  // Fish & Seafood
  'salmon': 'Fish & Seafood', 'tuna': 'Fish & Seafood', 'tilapia': 'Fish & Seafood',
  'cod': 'Fish & Seafood', 'halibut': 'Fish & Seafood', 'trout': 'Fish & Seafood',
  'snapper': 'Fish & Seafood', 'swordfish': 'Fish & Seafood', 'catfish': 'Fish & Seafood',
  'herring': 'Fish & Seafood', 'sardine': 'Fish & Seafood', 'anchovy': 'Fish & Seafood',
  'mahi': 'Fish & Seafood', 'bass': 'Fish & Seafood', 'fish': 'Fish & Seafood',
  'shrimp': 'Fish & Seafood', 'prawn': 'Fish & Seafood', 'lobster': 'Fish & Seafood',
  'crab': 'Fish & Seafood', 'scallop': 'Fish & Seafood', 'oyster': 'Fish & Seafood',
  'clam': 'Fish & Seafood', 'mussel': 'Fish & Seafood', 'squid': 'Fish & Seafood',
  'octopus': 'Fish & Seafood', 'crawfish': 'Fish & Seafood',
  // Dairy & Eggs
  'cottage cheese': 'Dairy & Eggs', 'cream cheese': 'Dairy & Eggs',
  'greek yogurt': 'Dairy & Eggs', 'oat milk': 'Dairy & Eggs', 'almond milk': 'Dairy & Eggs',
  'soy milk': 'Dairy & Eggs', 'coconut milk': 'Dairy & Eggs', 'half and half': 'Dairy & Eggs',
  'heavy cream': 'Dairy & Eggs', 'sour cream': 'Dairy & Eggs', 'whipping cream': 'Dairy & Eggs',
  'egg': 'Dairy & Eggs', 'milk': 'Dairy & Eggs', 'cheese': 'Dairy & Eggs',
  'butter': 'Dairy & Eggs', 'yogurt': 'Dairy & Eggs', 'cream': 'Dairy & Eggs',
  'cheddar': 'Dairy & Eggs', 'mozzarella': 'Dairy & Eggs', 'brie': 'Dairy & Eggs',
  'gouda': 'Dairy & Eggs', 'feta': 'Dairy & Eggs', 'ricotta': 'Dairy & Eggs',
  'provolone': 'Dairy & Eggs', 'gruyere': 'Dairy & Eggs', 'parmesan': 'Dairy & Eggs',
  'bocconcini': 'Dairy & Eggs', 'quark': 'Dairy & Eggs', 'buttermilk': 'Dairy & Eggs',
  'kefir': 'Dairy & Eggs', 'ghee': 'Dairy & Eggs',
  // Vegetables
  'cherry tomato': 'Vegetables', 'sweet potato': 'Vegetables', 'sweet corn': 'Vegetables',
  'bell pepper': 'Vegetables', 'green bean': 'Vegetables', 'snap pea': 'Vegetables',
  'bok choy': 'Vegetables', 'brussels': 'Vegetables',
  'broccoli': 'Vegetables', 'spinach': 'Vegetables', 'lettuce': 'Vegetables',
  'carrot': 'Vegetables', 'tomato': 'Vegetables', 'onion': 'Vegetables',
  'garlic': 'Vegetables', 'potato': 'Vegetables', 'corn': 'Vegetables',
  'cucumber': 'Vegetables', 'mushroom': 'Vegetables', 'avocado': 'Vegetables',
  'kale': 'Vegetables', 'zucchini': 'Vegetables', 'cauliflower': 'Vegetables',
  'cabbage': 'Vegetables', 'chard': 'Vegetables', 'collard': 'Vegetables',
  'arugula': 'Vegetables', 'edamame': 'Vegetables', 'celery': 'Vegetables',
  'fennel': 'Vegetables', 'artichoke': 'Vegetables', 'beet': 'Vegetables',
  'radish': 'Vegetables', 'turnip': 'Vegetables', 'parsnip': 'Vegetables',
  'leek': 'Vegetables', 'watercress': 'Vegetables', 'endive': 'Vegetables',
  'radicchio': 'Vegetables', 'jicama': 'Vegetables', 'kohlrabi': 'Vegetables',
  'asparagus': 'Vegetables', 'eggplant': 'Vegetables', 'squash': 'Vegetables',
  'yam': 'Vegetables', 'butternut': 'Vegetables', 'pumpkin': 'Vegetables',
  'jalapeño': 'Vegetables', 'jalapeno': 'Vegetables', 'poblano': 'Vegetables',
  'habanero': 'Vegetables', 'serrano': 'Vegetables', 'shallot': 'Vegetables',
  'pepper': 'Vegetables', 'pea': 'Vegetables',
  // Fruit
  'passion fruit': 'Fruit', 'dragon fruit': 'Fruit',
  'apple': 'Fruit', 'banana': 'Fruit', 'orange': 'Fruit', 'strawberry': 'Fruit',
  'blueberry': 'Fruit', 'grape': 'Fruit', 'mango': 'Fruit', 'peach': 'Fruit',
  'watermelon': 'Fruit', 'cantaloupe': 'Fruit', 'honeydew': 'Fruit',
  'pear': 'Fruit', 'cherry': 'Fruit', 'kiwi': 'Fruit', 'pomegranate': 'Fruit',
  'fig': 'Fruit', 'apricot': 'Fruit', 'nectarine': 'Fruit', 'plum': 'Fruit',
  'guava': 'Fruit', 'papaya': 'Fruit', 'lychee': 'Fruit', 'coconut': 'Fruit',
  'lime': 'Fruit', 'lemon': 'Fruit', 'grapefruit': 'Fruit', 'clementine': 'Fruit',
  'mandarin': 'Fruit', 'tangerine': 'Fruit', 'cranberry': 'Fruit', 'blackberry': 'Fruit',
  'raspberry': 'Fruit', 'pineapple': 'Fruit', 'date': 'Fruit',
  // Bread & Grains
  'english muffin': 'Bread & Grains', 'whole wheat': 'Bread & Grains',
  'white bread': 'Bread & Grains', 'brown rice': 'Bread & Grains',
  'bread': 'Bread & Grains', 'pasta': 'Bread & Grains', 'rice': 'Bread & Grains',
  'oat': 'Bread & Grains', 'cereal': 'Bread & Grains', 'tortilla': 'Bread & Grains',
  'sourdough': 'Bread & Grains', 'baguette': 'Bread & Grains', 'bagel': 'Bread & Grains',
  'pita': 'Bread & Grains', 'naan': 'Bread & Grains', 'flatbread': 'Bread & Grains',
  'wrap': 'Bread & Grains', 'brioche': 'Bread & Grains', 'rye': 'Bread & Grains',
  'pumpernickel': 'Bread & Grains', 'spaghetti': 'Bread & Grains',
  'fettuccine': 'Bread & Grains', 'penne': 'Bread & Grains', 'rigatoni': 'Bread & Grains',
  'linguine': 'Bread & Grains', 'orzo': 'Bread & Grains', 'couscous': 'Bread & Grains',
  'quinoa': 'Bread & Grains', 'barley': 'Bread & Grains', 'farro': 'Bread & Grains',
  'bulgur': 'Bread & Grains', 'granola': 'Bread & Grains', 'noodle': 'Bread & Grains',
  'ramen': 'Bread & Grains', 'udon': 'Bread & Grains', 'cornmeal': 'Bread & Grains',
  'flour': 'Bread & Grains', 'muffin': 'Bread & Grains', 'roll': 'Bread & Grains',
  'bun': 'Bread & Grains',
  // Condiments & Sauces
  'peanut butter': 'Condiments & Sauces', 'soy sauce': 'Condiments & Sauces',
  'olive oil': 'Condiments & Sauces', 'coconut oil': 'Condiments & Sauces',
  'avocado oil': 'Condiments & Sauces', 'hot sauce': 'Condiments & Sauces',
  'fish sauce': 'Condiments & Sauces', 'oyster sauce': 'Condiments & Sauces',
  'ketchup': 'Condiments & Sauces', 'mustard': 'Condiments & Sauces',
  'mayo': 'Condiments & Sauces', 'mayonnaise': 'Condiments & Sauces',
  'salsa': 'Condiments & Sauces', 'dressing': 'Condiments & Sauces',
  'relish': 'Condiments & Sauces', 'teriyaki': 'Condiments & Sauces',
  'worcestershire': 'Condiments & Sauces', 'hoisin': 'Condiments & Sauces',
  'pesto': 'Condiments & Sauces', 'aioli': 'Condiments & Sauces',
  'tahini': 'Condiments & Sauces', 'hummus': 'Condiments & Sauces',
  'guacamole': 'Condiments & Sauces', 'ranch': 'Condiments & Sauces',
  'caesar': 'Condiments & Sauces', 'balsamic': 'Condiments & Sauces',
  'vinegar': 'Condiments & Sauces', 'olive': 'Condiments & Sauces',
  'jam': 'Condiments & Sauces', 'jelly': 'Condiments & Sauces',
  'honey': 'Condiments & Sauces', 'syrup': 'Condiments & Sauces',
  // Drinks
  'orange juice': 'Drinks', 'apple juice': 'Drinks', 'grape juice': 'Drinks',
  'cranberry juice': 'Drinks', 'coconut water': 'Drinks', 'sparkling water': 'Drinks',
  'cold brew': 'Drinks', 'green tea': 'Drinks', 'herbal tea': 'Drinks',
  'protein shake': 'Drinks', 'energy drink': 'Drinks', 'sports drink': 'Drinks',
  'juice': 'Drinks', 'coffee': 'Drinks', 'tea': 'Drinks', 'wine': 'Drinks', 'beer': 'Drinks',
  'kombucha': 'Drinks', 'smoothie': 'Drinks', 'lemonade': 'Drinks', 'limeade': 'Drinks',
  'soda': 'Drinks', 'matcha': 'Drinks', 'chai': 'Drinks', 'seltzer': 'Drinks',
  // Snacks & Sweets
  'granola bar': 'Snacks & Sweets', 'protein bar': 'Snacks & Sweets',
  'trail mix': 'Snacks & Sweets', 'dark chocolate': 'Snacks & Sweets',
  'white chocolate': 'Snacks & Sweets', 'ice cream': 'Snacks & Sweets',
  'frozen yogurt': 'Snacks & Sweets', 'fruit snack': 'Snacks & Sweets',
  'chocolate': 'Snacks & Sweets', 'cookie': 'Snacks & Sweets',
  'almond': 'Snacks & Sweets', 'peanut': 'Snacks & Sweets',
  'nut': 'Snacks & Sweets', 'cake': 'Snacks & Sweets', 'pie': 'Snacks & Sweets',
  'popcorn': 'Snacks & Sweets', 'chips': 'Snacks & Sweets', 'pretzel': 'Snacks & Sweets',
  'cracker': 'Snacks & Sweets', 'jerky': 'Snacks & Sweets', 'gummy': 'Snacks & Sweets',
  'candy': 'Snacks & Sweets', 'brownie': 'Snacks & Sweets', 'donut': 'Snacks & Sweets',
  'cupcake': 'Snacks & Sweets', 'pudding': 'Snacks & Sweets', 'sorbet': 'Snacks & Sweets',
  'popsicle': 'Snacks & Sweets', 'wafer': 'Snacks & Sweets',
  // Herbs & Spices
  'fennel seed': 'Herbs & Spices', 'bay leaf': 'Herbs & Spices', 'lemongrass': 'Herbs & Spices',
  'basil': 'Herbs & Spices', 'cilantro': 'Herbs & Spices', 'parsley': 'Herbs & Spices',
  'dill': 'Herbs & Spices', 'mint': 'Herbs & Spices', 'thyme': 'Herbs & Spices',
  'rosemary': 'Herbs & Spices', 'oregano': 'Herbs & Spices', 'sage': 'Herbs & Spices',
  'chive': 'Herbs & Spices', 'tarragon': 'Herbs & Spices', 'curry': 'Herbs & Spices',
  'cumin': 'Herbs & Spices', 'paprika': 'Herbs & Spices', 'cayenne': 'Herbs & Spices',
  'cinnamon': 'Herbs & Spices', 'nutmeg': 'Herbs & Spices', 'cardamom': 'Herbs & Spices',
  'allspice': 'Herbs & Spices', 'anise': 'Herbs & Spices', 'turmeric': 'Herbs & Spices',
  'ginger': 'Herbs & Spices', 'salt': 'Herbs & Spices',
};

function getIcon(name: string): string {
  const lower = name.toLowerCase();
  const sorted = Object.entries(FOOD_ICONS).sort((a, b) => b[0].length - a[0].length);
  for (const [key, icon] of sorted) {
    if (key !== 'default' && lower.includes(key)) return icon;
  }
  return FOOD_ICONS.default;
}

function getFoodCategory(name: string): string {
  const lower = name.toLowerCase();
  const sorted = Object.entries(FOOD_CATEGORIES).sort((a, b) => b[0].length - a[0].length);
  for (const [key, cat] of sorted) {
    if (lower.includes(key)) return cat;
  }
  return 'Other';
}

function categoryFromOffTags(tags: string[]): string {
  const t = tags.join(' ').toLowerCase();
  if (/\b(meats?|beef|pork|lamb|veal|deli|charcuterie)\b/.test(t))          return 'Meat';
  if (/\b(poultry|chicken|turkey|duck)\b/.test(t))                          return 'Poultry';
  if (/\b(fish|seafood|salmon|tuna|shrimps?|shellfishes?)\b/.test(t))       return 'Fish & Seafood';
  if (/\b(dairies|dairy|milks?|cheeses?|yogurts?|eggs?|butters?|creams?)\b/.test(t)) return 'Dairy & Eggs';
  if (/\b(vegetables?|greens|salads?|legumes?)\b/.test(t))                  return 'Vegetables';
  if (/\b(fruits?)\b/.test(t))                                              return 'Fruit';
  if (/\b(breads?|cereals?|pastas?|grains?|noodles?|crackers?|biscuits?)\b/.test(t)) return 'Bread & Grains';
  if (/\b(condiments?|sauces?|dressings?|spreads?|oils?|vinegars?)\b/.test(t)) return 'Condiments & Sauces';
  if (/\b(beverages?|drinks?|juices?|sodas?|waters?|coffees?|teas?|smoothies?)\b/.test(t)) return 'Drinks';
  if (/\b(snacks?|sweets?|candies|chocolates?|cookies?|chips|confectionery)\b/.test(t)) return 'Snacks & Sweets';
  if (/\b(spices?|herbs?|seasonings?)\b/.test(t))                           return 'Herbs & Spices';
  return '';
}

const CATEGORY_ORDER = [
  'Meat', 'Poultry', 'Fish & Seafood', 'Dairy & Eggs', 'Vegetables',
  'Fruit', 'Bread & Grains', 'Condiments & Sauces', 'Drinks',
  'Snacks & Sweets', 'Herbs & Spices', 'Other',
];

const CATEGORY_ICONS: Record<string, string> = {
  'Meat': '🥩', 'Poultry': '🍗', 'Fish & Seafood': '🐟',
  'Dairy & Eggs': '🥛', 'Vegetables': '🥦', 'Fruit': '🍎',
  'Bread & Grains': '🍞', 'Condiments & Sauces': '🫙',
  'Drinks': '🧃', 'Snacks & Sweets': '🍫', 'Herbs & Spices': '🌿', 'Other': '🥗',
};

function getDaysLeft(d: string): number {
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.ceil((new Date(d).getTime() - today.getTime()) / 86400000);
}

function getBadge(days: number, cat: string): Badge {
  if (days < 0) return 'black';
  if (cat === 'freezer') return 'blue';
  if (days === 0) return 'red';
  if (days <= 5) return 'amber';
  return 'green';
}

function getExpiryText(days: number): string {
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return days + ' days';
}

const SORT_LABELS: Record<SortBy, string> = {
  expiry:      'Expiring First',
  expiryAsc:   'Freshest First',
  alpha:       'A → Z',
  alphaDesc:   'Z → A',
  protein:     'Highest Protein',
  proteinAsc:  'Lowest Protein',
  cal:         'Highest Cal',
  calAsc:      'Lowest Cal',
  recent:      'Recently Added',
  oldest:      'Oldest Added',
  category:    'By Category',
};

const SORT_ICONS: Record<SortBy, string> = {
  expiry: '⏰', expiryAsc: '🌿', alpha: '🔤', alphaDesc: '🔡',
  protein: '💪', proteinAsc: '➖', cal: '🔥', calAsc: '🍃',
  recent: '🕐', oldest: '📅', category: '📦',
};

const emptyForm = () => ({
  name: '', qty: '1', unit: '', expiryDate: '', category: 'fridge' as Category,
  protein: '', carbs: '', fat: '', cal: '', foodCategory: '',
});

const SCREEN_H = Dimensions.get('window').height;

function BottomSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const { colors } = useTheme();
  const overlay        = useRef(new Animated.Value(0)).current;
  const sheet          = useRef(new Animated.Value(600)).current;
  const kbOffset       = useRef(new Animated.Value(0)).current;
  const measuredSheetH = useRef(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      overlay.setValue(0); sheet.setValue(600);
      Animated.parallel([
        Animated.timing(overlay, { toValue: 1, duration: 280, useNativeDriver: true }),
        Animated.spring(sheet,   { toValue: 0, damping: 22, stiffness: 180, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      kbOffset.setValue(0);
      Animated.parallel([
        Animated.timing(overlay, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(sheet,   { toValue: 600, duration: 220, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible]);

  useEffect(() => {
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: any) => {
      const kbH = e.endCoordinates?.height ?? 0;
      // Only push the sheet up as far as it can go without the top leaving the screen
      const maxPush = Math.max(0, SCREEN_H - measuredSheetH.current - 60);
      Animated.timing(kbOffset, { toValue: -Math.min(kbH, maxPush), duration: e.duration ?? 250, useNativeDriver: true }).start();
    };
    const onHide = (e: any) => {
      Animated.timing(kbOffset, { toValue: 0, duration: e.duration ?? 200, useNativeDriver: true }).start();
    };
    const s1 = Keyboard.addListener(showEv, onShow);
    const s2 = Keyboard.addListener(hideEv, onHide);
    return () => { s1.remove(); s2.remove(); };
  }, []);

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: overlay }]} />
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
        <Animated.View
          onLayout={e => { measuredSheetH.current = e.nativeEvent.layout.height; }}
          style={{
            backgroundColor: colors.bg,
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: 20, maxHeight: SCREEN_H * 0.92,
            transform: [{ translateY: Animated.add(sheet, kbOffset) }],
          }}
        >
          <View style={{ width: 36, height: 4, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 999, alignSelf: 'center', marginBottom: 12 }} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const GOOD_CONFETTI = ['🌱', '✨', '💚', '🌿', '⭐', '🎉', '🌱', '✨'];
const BAD_CONFETTI  = ['🥀', '💸', '😔', '🗑', '🥀', '💸', '🌧', '💸'];

function ConfettiBlast({ good, onDone }: { good: boolean; onDone: () => void }) {
  const emojis = good ? GOOD_CONFETTI : BAD_CONFETTI;
  const N = emojis.length;

  const anims = useRef(
    Array.from({ length: N }, () => ({
      x:  new Animated.Value(0),
      y:  new Animated.Value(0),
      op: new Animated.Value(1),
      sc: new Animated.Value(0),
    }))
  ).current;

  const spread = useRef(
    Array.from({ length: N }, (_, i) => ({
      angle: (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.7,
      dist:  55 + Math.random() * 90,
      size:  8 + Math.floor(Math.random() * 8),
    }))
  ).current;

  useEffect(() => {
    const all = anims.map((a, i) => {
      const dx = Math.cos(spread[i].angle) * spread[i].dist;
      const dy = Math.sin(spread[i].angle) * spread[i].dist;
      return Animated.parallel([
        Animated.spring(a.sc, { toValue: 1, damping: 9, stiffness: 280, useNativeDriver: true }),
        Animated.timing(a.x,  { toValue: dx, duration: 620, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(a.y,  { toValue: dy, duration: 620, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(240),
          Animated.timing(a.op, { toValue: 0, duration: 380, useNativeDriver: true }),
        ]),
      ]);
    });
    Animated.parallel(all).start(onDone);
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {anims.map((a, i) => (
        <Animated.Text
          key={i}
          style={{
            position: 'absolute',
            top: '46%' as any,
            left: '46%' as any,
            fontSize: spread[i].size,
            opacity: a.op,
            transform: [{ translateX: a.x }, { translateY: a.y }, { scale: a.sc }],
          }}
        >
          {emojis[i]}
        </Animated.Text>
      ))}
    </View>
  );
}

export default function FridgeScreen() {
  const router = useRouter();
  const { colors, isDark, toggleTheme } = useTheme();
  const { signOut } = useAuth();
  const [listDensity, setListDensity] = useState<'compact' | 'regular'>('regular');
  const styles = useMemo(() => createStyles(colors, listDensity === 'compact'), [colors, listDensity]);
  const [items, setItems]               = useState<Item[]>([]);
  const [expanded, setExpanded]         = useState<number | null>(null);
  const [activeTab, setActiveTab]       = useState<Category>('fridge');
  const [showAdd, setShowAdd]           = useState(false);
  const [showDrawer, setShowDrawer]     = useState(false);
  const [editItem, setEditItem]         = useState<Item | null>(null);
  const [form, setForm]                 = useState(emptyForm());
  const [nextId, setNextId]             = useState(100);
  const [sortBy, setSortBy]             = useState<SortBy>('expiry');
  const [scanning, setScanning]         = useState(false);
  const [searchQuery, setSearchQuery]   = useState('');
  const [showSortFilter, setShowSortFilter]         = useState(false);
  const [showExpiringDetail, setShowExpiringDetail] = useState(false);
  const [filterFoodCats, setFilterFoodCats]         = useState<string[]>([]);
  const [filterExpiry, setFilterExpiry]             = useState<string[]>([]);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [barcodeScanned, setBarcodeScanned]         = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [showSuccess, setShowSuccess]               = useState(false);
  const [barcodeProcessing, setBarcodeProcessing]   = useState(false);
  const [scannedName, setScannedName]               = useState('');
  const [scannedEmoji, setScannedEmoji]             = useState('🔍');
  const [scanSuccess, setScanSuccess]               = useState<boolean | null>(null);

  const drawerAnim  = useRef(new Animated.Value(-280)).current;
  const menuAnim    = useRef(new Animated.Value(0)).current;
  const listFade    = useRef(new Animated.Value(1)).current;
  const listSlide   = useRef(new Animated.Value(0)).current;
  const addBtnScale = useRef(new Animated.Value(1)).current;
  const scanPulse   = useRef(new Animated.Value(1)).current;
  const beamAnim    = useRef(new Animated.Value(0)).current;
  const successAnim = useRef(new Animated.Value(0)).current;
  const removeAnims = useRef<Map<number, { x: Animated.Value; op: Animated.Value }>>(new Map());
  const screenFade  = useRef(new Animated.Value(0)).current;
  const screenSlide = useRef(new Animated.Value(24)).current;
  const loadOverlayAnim = useRef(new Animated.Value(0)).current;
  const loadEmojiAnim   = useRef(new Animated.Value(0)).current;
  const loadRingAnim    = useRef(new Animated.Value(0)).current;
  const loadResultAnim  = useRef(new Animated.Value(0)).current;
  const ringLoopRef     = useRef<Animated.CompositeAnimation | null>(null);
  const emojiLoopRef    = useRef<Animated.CompositeAnimation | null>(null);
  const [blastVisible, setBlastVisible] = useState(false);
  const [badVisible,   setBadVisible]   = useState(false);
  const [toastMsg, setToastMsg]         = useState('');
  const [toastBad, setToastBad]         = useState(false);
  const toastAnim = useRef(new Animated.Value(0)).current;

  const [showProfile, setShowProfile]               = useState(false);
  const [showNotifications, setShowNotifications]   = useState(false);
  const [showPro, setShowPro]                       = useState(false);
  const [showHelp, setShowHelp]                     = useState(false);
  const [showRate, setShowRate]                     = useState(false);
  const [profileName, setProfileName]               = useState('');
  const [profileEmail, setProfileEmail]             = useState('');
  const [profilePhoto, setProfilePhoto]             = useState<string | null>(null);
  const [dietaryPrefs, setDietaryPrefs]             = useState<string[]>([]);
  const [householdSize, setHouseholdSize]           = useState(1);
  const [stats, setStats]                           = useState({ goneGood: 0, goneBad: 0, totalAdded: 0 });
  const [notifExpiry, setNotifExpiry]               = useState(true);
  const [notifDigest, setNotifDigest]               = useState(false);
  const [notifWeekly, setNotifWeekly]               = useState(false);
  const [rating, setRating]                         = useState(0);
  const [review, setReview]                         = useState('');
  const [openFaq, setOpenFaq]                       = useState<number | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('gogood_items').then(val => {
      if (val) {
        const parsed = JSON.parse(val);
        const migrated = parsed.map((i: any, idx: number) => ({
          ...i,
          id: i.id || (200 + idx),
          baseName: i.baseName || i.name || '',
          batch: i.batch || 1,
          addedAt: i.addedAt || Date.now(),
        }));
        const seen = new Set();
        const deduped = migrated.map((i: any, idx: number) => {
          if (seen.has(i.id)) return { ...i, id: 1000 + idx };
          seen.add(i.id);
          return i;
        });
        setItems(deduped);
        const maxId = Math.max(...deduped.map((i: any) => i.id), 99);
        setNextId(maxId + 1);
      }
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem('gogood_items', JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    AsyncStorage.getItem('gogood_profile').then(v => { if (v) { const p = JSON.parse(v); setProfileName(p.name || ''); setProfileEmail(p.email || ''); setProfilePhoto(p.photo || null); setDietaryPrefs(p.dietary || []); setHouseholdSize(p.household || 1); } });
    AsyncStorage.getItem('gogood_notifs').then(v => { if (v) { const n = JSON.parse(v); setNotifExpiry(n.expiry ?? true); setNotifDigest(n.digest ?? false); setNotifWeekly(n.weekly ?? false); } });
    AsyncStorage.getItem('gogood_stats').then(v => { if (v) setStats(JSON.parse(v)); });
    AsyncStorage.getItem('gogood_density').then(v => { if (v === 'compact' || v === 'regular') setListDensity(v); });
  }, []);

  useEffect(() => {
    if (scanning) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scanPulse, { toValue: 0.35, duration: 560, useNativeDriver: true }),
          Animated.timing(scanPulse, { toValue: 1,    duration: 560, useNativeDriver: true }),
        ])
      ).start();
    } else {
      scanPulse.stopAnimation();
      Animated.timing(scanPulse, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    }
  }, [scanning]);

  useEffect(() => {
    if (showBarcodeScanner) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(beamAnim, { toValue: 1, duration: 1700, useNativeDriver: true }),
          Animated.timing(beamAnim, { toValue: 0, duration: 1700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      beamAnim.stopAnimation();
      beamAnim.setValue(0);
    }
  }, [showBarcodeScanner]);

  useFocusEffect(useCallback(() => {
    screenFade.setValue(0);
    screenSlide.setValue(24);
    Animated.parallel([
      Animated.timing(screenFade,  { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.spring(screenSlide, { toValue: 0, damping: 24, stiffness: 200, useNativeDriver: true }),
    ]).start();
  }, []));

  const toggleDensity = () => {
    const next = listDensity === 'compact' ? 'regular' : 'compact';
    setListDensity(next);
    AsyncStorage.setItem('gogood_density', next);
  };

  const openFromDrawer = (setter: (v: boolean) => void) => {
    Animated.parallel([
      Animated.timing(drawerAnim, { toValue: -280, duration: 200, useNativeDriver: true }),
      Animated.timing(menuAnim,   { toValue: 0,    duration: 200, useNativeDriver: true }),
    ]).start(() => { setShowDrawer(false); setter(true); });
  };

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out', style: 'destructive', onPress: async () => {
          closeDrawer();
          await signOut();
          router.replace('/auth/welcome' as any);
        },
      },
    ]);
  };

  const pickProfilePhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { showToast('Gallery permission needed', true); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!result.canceled && result.assets[0]) setProfilePhoto(result.assets[0].uri);
  };

  const saveProfile = async () => {
    await AsyncStorage.setItem('gogood_profile', JSON.stringify({ name: profileName, email: profileEmail, photo: profilePhoto, dietary: dietaryPrefs, household: householdSize }));
    setShowProfile(false);
    showToast('Profile saved ✓');
  };

  const saveNotifications = async () => {
    await AsyncStorage.setItem('gogood_notifs', JSON.stringify({ expiry: notifExpiry, digest: notifDigest, weekly: notifWeekly }));
    setShowNotifications(false);
    showToast('Notifications updated ✓');
  };

  const openDrawer = () => {
    setShowDrawer(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.parallel([
      Animated.spring(drawerAnim, { toValue: 0, damping: 24, stiffness: 200, useNativeDriver: true }),
      Animated.timing(menuAnim,   { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
  };

  const closeDrawer = () => {
    Animated.parallel([
      Animated.timing(drawerAnim, { toValue: -280, duration: 230, useNativeDriver: true }),
      Animated.timing(menuAnim,   { toValue: 0,    duration: 210, useNativeDriver: true }),
    ]).start(() => setShowDrawer(false));
  };

  const switchTab = (tab: Category) => {
    if (tab === activeTab) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.parallel([
      Animated.timing(listFade,  { toValue: 0, duration: 110, useNativeDriver: true }),
      Animated.timing(listSlide, { toValue: 10, duration: 110, useNativeDriver: true }),
    ]).start(() => {
      setActiveTab(tab);
      setExpanded(null);
      listSlide.setValue(-10);
      Animated.parallel([
        Animated.timing(listFade,  { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(listSlide, { toValue: 0, damping: 22, stiffness: 280, useNativeDriver: true }),
      ]).start();
    });
  };

  const getRemoveAnim = (id: number) => {
    if (!removeAnims.current.has(id)) {
      removeAnims.current.set(id, { x: new Animated.Value(0), op: new Animated.Value(1) });
    }
    return removeAnims.current.get(id)!;
  };

  const animateRemove = (id: number, dir: 1 | -1, callback: () => void) => {
    const { x, op } = getRemoveAnim(id);
    Animated.parallel([
      Animated.timing(x,  { toValue: dir * 400, duration: 290, useNativeDriver: true }),
      Animated.timing(op, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => { removeAnims.current.delete(id); callback(); });
  };

  const triggerSuccess = () => {
    setShowSuccess(true);
    successAnim.setValue(0);
    Animated.sequence([
      Animated.spring(successAnim, { toValue: 1, damping: 13, stiffness: 220, useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(successAnim, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start(() => setShowSuccess(false));
  };

  const getFiltered = () => {
    let list = [...items.filter(i => i.category === activeTab)];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(i => i.baseName.toLowerCase().includes(q));
    }
    if (filterFoodCats.length > 0) {
      list = list.filter(i => filterFoodCats.includes(i.foodCategory || getFoodCategory(i.baseName)));
    }
    if (filterExpiry.length > 0) {
      list = list.filter(i => {
        const d = getDaysLeft(i.expiryDate);
        if (filterExpiry.includes('expired') && d < 0) return true;
        if (filterExpiry.includes('today')   && d === 0) return true;
        if (filterExpiry.includes('soon')    && d >= 1 && d <= 3) return true;
        if (filterExpiry.includes('fresh')   && d > 3) return true;
        return false;
      });
    }
    if (sortBy === 'expiry')      list.sort((a,b) => getDaysLeft(a.expiryDate) - getDaysLeft(b.expiryDate));
    if (sortBy === 'expiryAsc')   list.sort((a,b) => getDaysLeft(b.expiryDate) - getDaysLeft(a.expiryDate));
    if (sortBy === 'alpha')       list.sort((a,b) => (a.baseName||'').localeCompare(b.baseName||''));
    if (sortBy === 'alphaDesc')   list.sort((a,b) => (b.baseName||'').localeCompare(a.baseName||''));
    if (sortBy === 'protein')     list.sort((a,b) => b.protein - a.protein);
    if (sortBy === 'proteinAsc')  list.sort((a,b) => a.protein - b.protein);
    if (sortBy === 'cal')         list.sort((a,b) => b.cal - a.cal);
    if (sortBy === 'calAsc')      list.sort((a,b) => a.cal - b.cal);
    if (sortBy === 'recent')      list.sort((a,b) => b.addedAt - a.addedAt);
    if (sortBy === 'oldest')      list.sort((a,b) => a.addedAt - b.addedAt);
    if (sortBy === 'category')    list.sort((a,b) => getFoodCategory(a.baseName).localeCompare(getFoodCategory(b.baseName)));
    return list;
  };

  const filtered        = getFiltered();
  const allInTab        = items.filter(i => i.category === activeTab);
  const allExpiringSoon = items.filter(i => getDaysLeft(i.expiryDate) <= 3);
  const totalProtein    = filtered.reduce((a,i) => a + i.protein * i.qtyNum, 0);
  const totalCarbs      = filtered.reduce((a,i) => a + i.carbs   * i.qtyNum, 0);
  const totalFat        = filtered.reduce((a,i) => a + i.fat     * i.qtyNum, 0);
  const totalCal        = filtered.reduce((a,i) => a + i.cal     * i.qtyNum, 0);
  const expiringSoon    = allInTab.filter(i => i.days <= 3).length;

  const availableFoodCats = [...new Set(allInTab.map(i => i.foodCategory || getFoodCategory(i.baseName)))].sort();

  const goodBotMsg = () => {
    if (allInTab.length === 0) return 'add items to get started';
    const urgentCount = allInTab.filter(i => i.days < 0).length;
    if (urgentCount > 0) return `${urgentCount} item${urgentCount > 1 ? 's' : ''} already expired — rescue what you can 🥀`;
    if (expiringSoon >= 3) return `using ${expiringSoon} expiring items`;
    if (expiringSoon > 0) return `${expiringSoon} item${expiringSoon > 1 ? 's' : ''} expiring — let's use them 🌱`;
    return `you have ${allInTab.length} items — want a recipe? 🍳`;
  };

  const showToast = (msg: string, bad = false) => {
    setToastMsg(msg); setToastBad(bad);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(toastAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  const triggerBlast = (bad = false) => {
    if (bad) setBadVisible(true); else setBlastVisible(true);
  };

  const changeQty = (id: number, delta: number) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, qtyNum: Math.max(0, i.qtyNum + delta) } : i).filter(i => i.qtyNum > 0));
  };

  const updateStats = (key: 'goneGood' | 'goneBad' | 'totalAdded') => {
    setStats(prev => { const u = { ...prev, [key]: prev[key] + 1 }; AsyncStorage.setItem('gogood_stats', JSON.stringify(u)); return u; });
  };

  const goneGood = (item: Item) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    animateRemove(item.id, 1, () => {
      setItems(prev => prev.filter(i => i.id !== item.id));
      if (expanded === item.id) setExpanded(null);
    });
    triggerBlast(false);
    setTimeout(() => showToast(`${item.baseName} gone good! 🌱`), 700);
    updateStats('goneGood');
  };

  const goneBad = (item: Item) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    animateRemove(item.id, -1, () => {
      setItems(prev => prev.filter(i => i.id !== item.id));
      if (expanded === item.id) setExpanded(null);
      AsyncStorage.getItem('gogood_gone_bad').then(val => {
        const prev = val ? JSON.parse(val) : [];
        const entry = { id: item.id, name: item.baseName, icon: item.icon, date: new Date().toISOString(), expiryDate: item.expiryDate };
        AsyncStorage.setItem('gogood_gone_bad', JSON.stringify([entry, ...prev]));
      });
    });
    triggerBlast(true);
    setTimeout(() => showToast(`${item.baseName} gone bad 🥀`, true), 700);
    updateStats('goneBad');
  };

  const removeItem = (id: number) => {
    setItems(prev => prev.filter(i => i.id !== id));
    if (expanded === id) setExpanded(null);
  };

  const openAdd = () => { setForm(emptyForm()); setEditItem(null); setShowAdd(true); };

  const openEdit = (item: Item) => {
    setForm({
      name: item.baseName, qty: String(item.qtyNum), unit: item.unit,
      expiryDate: item.expiryDate, category: item.category,
      protein: String(item.protein), carbs: String(item.carbs),
      fat: String(item.fat), cal: String(item.cal),
      foodCategory: item.foodCategory || '',
    });
    setEditItem(item);
    setShowAdd(true);
  };

  const openBarcodeScanner = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) { showToast('Camera permission needed', true); return; }
    }
    setShowAdd(false);
    setBarcodeScanned(false);
    // Wait for BottomSheet close animation (220ms) before opening camera Modal
    setTimeout(() => setShowBarcodeScanner(true), 280);
  };

  const handleBarcodeScan = async ({ data }: { data: string }) => {
    if (barcodeScanned) return;
    setBarcodeScanned(true);
    setBarcodeProcessing(true);
    setScanSuccess(null);
    setScannedEmoji('🔍');
    loadResultAnim.setValue(0);

    // Animate overlay in
    Animated.timing(loadOverlayAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();

    // Start sonar ring loop
    ringLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(loadRingAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(loadRingAnim, { toValue: 0, duration: 0,    useNativeDriver: true }),
      ])
    );
    ringLoopRef.current.start();

    // Start emoji bounce loop
    emojiLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(loadEmojiAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(loadEmojiAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
      ])
    );
    emojiLoopRef.current.start();

    const finishScan = (success: boolean, name: string, emoji: string, formUpdater?: () => void) => {
      ringLoopRef.current?.stop();
      emojiLoopRef.current?.stop();
      if (success) {
        setScannedEmoji(emoji);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      setScanSuccess(success);
      setScannedName(name);
      formUpdater?.();
      Animated.spring(loadResultAnim, { toValue: 1, damping: 18, stiffness: 200, useNativeDriver: true }).start();
      setTimeout(() => {
        Animated.timing(loadOverlayAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
          setBarcodeProcessing(false);
          loadRingAnim.setValue(0);
          loadEmojiAnim.setValue(0);
        });
        setShowBarcodeScanner(false);
        setTimeout(() => setShowAdd(true), 300);
      }, 900);
    };

    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${data}.json?fields=product_name,brands,quantity,serving_size,nutriments,expiration_date,categories_tags`
      );
      const json = await res.json();

      if (json.status !== 1 || !json.product) {
        finishScan(false, 'Not in database', '🔍');
        return;
      }

      const p = json.product;
      const n = p.nutriments || {};
      const name = [p.brands, p.product_name].filter(Boolean).join(' ');

      let qty = '1'; let unit = '';
      const qtyMatch = (p.quantity || '').match(/^([\d.]+)\s*([a-zA-Z]+)/);
      if (qtyMatch) { qty = qtyMatch[1]; unit = qtyMatch[2].toLowerCase(); }

      // Open Food Facts sometimes has expiration_date in formats like "2026-08" or "08/2026"
      let expiryDate = '';
      if (p.expiration_date) {
        const raw = p.expiration_date.trim();
        const ymd = raw.match(/^(\d{4})-(\d{2})-?(\d{2})?$/);
        const mdy = raw.match(/^(\d{2})\/(\d{4})$/);
        if (ymd) expiryDate = `${ymd[1]}-${ymd[2]}-${ymd[3] || '01'}`;
        else if (mdy) expiryDate = `${mdy[2]}-${mdy[1]}-01`;
      }

      const productName = p.product_name || name;
      const offCat = categoryFromOffTags(p.categories_tags || []);
      finishScan(true, productName, getIcon(productName), () => {
        setForm(f => ({
          ...f,
          name:         name         || f.name,
          qty:          qty          || f.qty,
          unit:         unit         || f.unit,
          expiryDate:   expiryDate   || f.expiryDate,
          foodCategory: offCat       || f.foodCategory,
          cal:     n['energy-kcal_serving'] != null ? String(Math.round(n['energy-kcal_serving'])) : f.cal,
          protein: n['proteins_serving']    != null ? String(Math.round(n['proteins_serving']))    : f.protein,
          carbs:   n['carbohydrates_serving'] != null ? String(Math.round(n['carbohydrates_serving'])) : f.carbs,
          fat:     n['fat_serving']          != null ? String(Math.round(n['fat_serving']))          : f.fat,
        }));
      });
    } catch {
      finishScan(false, 'Lookup failed', '🔍');
    }
  };

  const scanLabel = async () => {
    setScanning(true);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { showToast('Camera permission needed', true); setScanning(false); return; }
      const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.8 });
      if (result.canceled || !result.assets[0]) { setScanning(false); return; }
      showToast('Scanning label... 📷');
      const base64 = result.assets[0].base64;
      const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
      if (!apiKey || apiKey === 'your_api_key_here') { showToast('Add your API key to .env', true); setScanning(false); return; }
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', max_tokens: 400,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: 'You are a food label scanner. Look at this image and extract: product name (specific, e.g. "Whole Milk 2%" not just "milk"), quantity as a number, unit (lbs, oz, g, kg, ml, L, or count), best-by/use-by/expiry date as YYYY-MM-DD (if only month/day visible assume current year 2026), calories per serving, protein grams per serving, carbohydrates grams per serving, fat grams per serving. If a field is not visible set it to 0 or empty string. Respond ONLY with raw JSON, no markdown, no explanation: {"name":"","qty":1,"unit":"","expiryDate":"","cal":0,"protein":0,"carbs":0,"fat":0}' }
          ]}]
        })
      });
      const data = await response.json();
      if (!data.content?.[0]?.text) throw new Error('No response');
      const json = JSON.parse(data.content[0].text.replace(/```json|```/g, '').trim());
      setForm(f => ({
        ...f,
        name:       json.name       || f.name,
        qty:        json.qty        ? String(json.qty)     : f.qty,
        unit:       json.unit       || f.unit,
        expiryDate: json.expiryDate || f.expiryDate,
        cal:        json.cal        ? String(json.cal)     : f.cal,
        protein:    json.protein    ? String(json.protein) : f.protein,
        carbs:      json.carbs      ? String(json.carbs)   : f.carbs,
        fat:        json.fat        ? String(json.fat)     : f.fat,
      }));
      showToast('Label scanned! 🌱');
    } catch (e) {
      showToast('Could not read label', true);
    }
    setScanning(false);
  };

  const saveItem = () => {
    const safeName   = (form.name || '').trim();
    const safeExpiry = (form.expiryDate || '').trim();
    if (!safeName || !safeExpiry) { showToast('Name and expiry date required', true); return; }
    const days  = getDaysLeft(safeExpiry);
    const badge = getBadge(days, form.category);
    const existing = items.filter(i =>
      (i.baseName || '').toLowerCase() === safeName.toLowerCase() &&
      i.category === form.category &&
      (!editItem || i.id !== editItem.id)
    );
    const batchNum = !editItem && existing.length > 0 ? existing.length + 1 : (editItem ? editItem.batch : 1);
    const built: Item = {
      id:         editItem ? editItem.id : nextId,
      icon:       getIcon(safeName),
      name:       safeName,
      baseName:   safeName,
      batch:      batchNum,
      qty:        (form.qty + ' ' + form.unit).trim(),
      expiryDate: safeExpiry,
      expires:    getExpiryText(days),
      badge, days,
      protein:  parseFloat(form.protein) || 0,
      carbs:    parseFloat(form.carbs)   || 0,
      fat:      parseFloat(form.fat)     || 0,
      cal:      parseFloat(form.cal)     || 0,
      qtyNum:   parseInt(form.qty)       || 1,
      unit:     form.unit,
      category: form.category,
      addedAt:      editItem ? editItem.addedAt : Date.now(),
      foodCategory: form.foodCategory || (editItem ? editItem.foodCategory : undefined),
    };
    if (editItem) {
      setItems(prev => prev.map(i => i.id === editItem.id ? built : i));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(`${safeName} updated ✏️`);
    } else {
      setItems(prev => [...prev, built]);
      setNextId(prev => prev + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      triggerSuccess();
      showToast(`${safeName} added! 🌱`);
      updateStats('totalAdded');
    }
    setShowAdd(false);
  };

  const renderItems = () => {
    const grouped: Record<string, Item[]> = {};
    filtered.forEach(item => {
      const cat = item.foodCategory || getFoodCategory(item.baseName);
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    });
    return CATEGORY_ORDER
      .filter(cat => grouped[cat]?.length > 0)
      .flatMap(cat => [
        <View key={`hdr-${cat}`} style={styles.categoryHeader}>
          <Text style={styles.categoryHeaderEmoji}>{CATEGORY_ICONS[cat]}</Text>
          <Text style={[styles.categoryHeaderText, { color: colors.textSub }]}>{cat}</Text>
          <View style={[styles.categoryHeaderLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.categoryHeaderCount, { color: colors.textMuted }]}>{grouped[cat].length}</Text>
        </View>,
        ...grouped[cat].map(item => renderItemCard(item)),
      ]);
  };

  const renderItemCard = (item: Item) => {
    const liveDays    = getDaysLeft(item.expiryDate);
    const liveBadge   = getBadge(liveDays, item.category);
    const liveExpires = getExpiryText(liveDays);
    const { x, op }   = getRemoveAnim(item.id);
    return (
    <Animated.View key={item.id} style={{ transform: [{ translateX: x }], opacity: op, marginBottom: styles.itemWrapMargin.height }}>
    <View style={[styles.itemCard, expanded === item.id && styles.itemCardExpanded]}>
      <TouchableOpacity
        style={styles.itemMain}
        onPress={() => setExpanded(prev => prev === item.id ? null : item.id)}
        activeOpacity={0.7}
      >
        <View style={[styles.iconWrap, { backgroundColor: ICON_BG[liveBadge] }]}>
          <Text style={styles.itemIcon}>{item.icon}</Text>
        </View>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemName, liveBadge === 'black' && { color: '#6B6860' }]}>
            {item.baseName}
            {item.batch > 1 && <Text style={styles.batchInline}> · batch {item.batch}</Text>}
          </Text>
          <Text style={styles.itemQty}>{item.qty}</Text>
        </View>
        <View style={styles.itemRight}>
          <View style={[styles.badge, { backgroundColor: ICON_BG[liveBadge] }]}>
            <Text style={[styles.badgeText, { color: BADGE_SOFT[liveBadge].text }]}>{liveExpires}</Text>
          </View>
          {expanded !== item.id && <Text style={styles.tapDetails}>tap for details</Text>}
        </View>
      </TouchableOpacity>

      {expanded === item.id && (
        <View style={styles.itemDetail}>
          <View style={styles.detailMacros}>
            {[
              { label: 'protein', val: item.protein ? item.protein + 'g' : '—' },
              { label: 'carbs',   val: item.carbs   ? item.carbs   + 'g' : '—' },
              { label: 'fat',     val: item.fat     ? item.fat     + 'g' : '—' },
              { label: 'cal',     val: item.cal     ? String(item.cal)   : '—' },
            ].map(m => (
              <View key={m.label} style={styles.macroPill}>
                <Text style={styles.macroPillNum}>{m.val}</Text>
                <Text style={styles.macroPillLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>quantity</Text>
            <View style={styles.qtyControls}>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => changeQty(item.id, -1)}>
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qtyNum}>{item.qtyNum} {item.unit}</Text>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => changeQty(item.id, 1)}>
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.actionBtn, styles.actionUsed]} onPress={() => goneGood(item)}>
              <Text style={styles.actionUsedText}>✓ gone good</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBad]} onPress={() => goneBad(item)}>
              <Text style={styles.actionBadText}>🥀 gone bad</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.actionEdit]} onPress={() => openEdit(item)}>
              <Text style={styles.actionEditText}>✏️</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.actionDelete]} onPress={() => removeItem(item.id)}>
              <Text style={styles.actionDeleteText}>🗑</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
    </Animated.View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
      <Animated.View style={[styles.container, { opacity: screenFade, transform: [{ translateY: screenSlide }] }]}>

        {blastVisible && <ConfettiBlast good={true}  onDone={() => setBlastVisible(false)} />}
        {badVisible   && <ConfettiBlast good={false} onDone={() => setBadVisible(false)}  />}
        {showSuccess && (
          <Animated.View
            style={[styles.successOverlay, { opacity: successAnim, transform: [{ scale: successAnim }] }]}
            pointerEvents="none"
          >
            <View style={styles.successCircle}>
              <Text style={{ fontSize: 34, color: 'white' }}>✓</Text>
            </View>
          </Animated.View>
        )}

        <Animated.View style={[
          styles.toast,
          toastBad && styles.toastBad,
          { opacity: toastAnim, transform: [{ translateY: toastAnim.interpolate({ inputRange: [0,1], outputRange: [-16, 0] }) }] }
        ]}>
          <Text style={styles.toastText}>{toastMsg}</Text>
        </Animated.View>

        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.menuBtn} onPress={showDrawer ? closeDrawer : openDrawer}>
            <Animated.View style={[styles.menuLine, { transform: [
              { translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 6.5] }) },
              { rotate:    menuAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) },
            ]}]} />
            <Animated.View style={[styles.menuLine, { width: 14,
              opacity:   menuAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
              transform: [{ scaleX: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) }],
            }]} />
            <Animated.View style={[styles.menuLine, { transform: [
              { translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -6.5] }) },
              { rotate:    menuAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-45deg'] }) },
            ]}]} />
          </TouchableOpacity>
          <Text style={styles.logo}>go<Text style={styles.logoGreen}>good</Text></Text>
          <Animated.View style={{ transform: [{ scale: addBtnScale }] }}>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={openAdd}
              onPressIn={() => Animated.spring(addBtnScale, { toValue: 0.85, useNativeDriver: true }).start()}
              onPressOut={() => Animated.spring(addBtnScale, { toValue: 1, damping: 10, stiffness: 260, useNativeDriver: true }).start()}
            >
              <Text style={styles.addBtnText}>+</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* ── Search row ── */}
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="search your fridge..."
              placeholderTextColor={colors.placeholder}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Text style={{ color: '#bbb', fontSize: 14, paddingHorizontal: 4 }}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Tabs ── */}
        <View style={styles.tabs}>
          {(['fridge', 'freezer', 'pantry'] as const).map(tab => (
            <TouchableOpacity key={tab} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => switchTab(tab)}>
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === 'fridge' ? '🥗' : tab === 'freezer' ? '❄️' : '🥫'} {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Macro bar ── */}
        <View style={styles.macroBar}>
          <Text style={styles.macroTitle}>{activeTab.toUpperCase()} MACROS</Text>
          <View style={styles.macroRow}>
            {[
              { label: 'PROTEIN', val: Math.round(totalProtein) + 'g' },
              { label: 'CARBS',   val: Math.round(totalCarbs)   + 'g' },
              { label: 'FAT',     val: Math.round(totalFat)     + 'g' },
              { label: 'CAL',     val: String(Math.round(totalCal)) },
            ].map((m, i) => (
              <View key={m.label} style={styles.macroItem}>
                {i > 0 && <View style={styles.macroDivider} />}
                <View style={styles.macroItemInner}>
                  <Text style={styles.macroNum}>{m.val}</Text>
                  <Text style={styles.macroLabel}>{m.label}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ── Sort bar ── */}
        <View style={styles.sortBar}>
          <View style={styles.sortBarLeft}>
            {allExpiringSoon.length > 0 ? (
              <TouchableOpacity style={styles.expiringBadge} onPress={() => setShowExpiringDetail(true)}>
                <Text style={styles.expiringBadgeText}>{allExpiringSoon.length} expiring soon</Text>
              </TouchableOpacity>
            ) : <View />}
          </View>
          <Text style={styles.sortBarLabel}>{SORT_LABELS[sortBy].toUpperCase()}</Text>
          <View style={styles.sortBarRight}>
            <TouchableOpacity onPress={() => setShowSortFilter(true)}>
              <Text style={styles.sortFilterBtnText}>sort & filter ↕</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Items ── */}
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 4, paddingBottom: 12 }}>
          <Animated.View style={{ opacity: listFade, transform: [{ translateY: listSlide }] }}>
            {filtered.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🥗</Text>
                <Text style={styles.emptyTitle}>{searchQuery || filterFoodCats.length > 0 ? 'No matches' : 'Nothing here yet'}</Text>
                <Text style={styles.emptySub}>{searchQuery || filterFoodCats.length > 0 ? 'Try adjusting your search or filters' : 'Tap + to add your first item'}</Text>
              </View>
            ) : renderItems()}
          </Animated.View>
        </ScrollView>

        {/* ── Good Bot CTA ── */}
        <View style={styles.goodBotWrapper}>
          <TouchableOpacity style={styles.goodBotBtn} onPress={() => allInTab.length === 0 ? openAdd() : router.navigate('/(tabs)/goodbot' as any)}>
            <View style={styles.goodBotLeft}>
              <View style={styles.goodBotAvatarWrap}>
                <Text style={{ fontSize: 20 }}>🤖</Text>
              </View>
              <View>
                <Text style={styles.goodBotText}>Ask Good Bot what to make</Text>
                <Text style={styles.goodBotSub}>{goodBotMsg()}</Text>
              </View>
            </View>
            <Text style={styles.goodBotArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* ── Drawer ── */}
        {showDrawer && (
          <TouchableOpacity style={styles.drawerOverlay} activeOpacity={1} onPress={closeDrawer}>
            <Animated.View style={[styles.drawer, { transform: [{ translateX: drawerAnim }] }]}>
              <TouchableOpacity activeOpacity={1}>
                <View style={styles.drawerHeader}>
                  <Text style={styles.drawerLogo}>go<Text style={styles.drawerLogoGreen}>good</Text></Text>
                  <TouchableOpacity onPress={closeDrawer} style={styles.drawerClose}>
                    <Text style={styles.drawerCloseText}>✕</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.drawerSection}>
                  <Text style={styles.drawerSectionLabel}>account</Text>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => openFromDrawer(setShowProfile)}>
                    <Text style={styles.drawerItemIcon}>👤</Text>
                    <Text style={styles.drawerItemText}>Profile</Text>
                    <Text style={styles.drawerItemArrow}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => openFromDrawer(setShowNotifications)}>
                    <Text style={styles.drawerItemIcon}>🔔</Text>
                    <Text style={styles.drawerItemText}>Notifications</Text>
                    <Text style={styles.drawerItemArrow}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => openFromDrawer(setShowPro)}>
                    <Text style={styles.drawerItemIcon}>🌱</Text>
                    <Text style={styles.drawerItemText}>Go Good Pro</Text>
                    <View style={styles.proBadge}><Text style={styles.proBadgeText}>soon</Text></View>
                  </TouchableOpacity>
                </View>
                <View style={styles.drawerSection}>
                  <Text style={styles.drawerSectionLabel}>app</Text>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => { closeDrawer(); router.navigate('/(tabs)/foodreport' as any); }}>
                    <Text style={styles.drawerItemIcon}>📊</Text>
                    <Text style={styles.drawerItemText}>Food Report</Text>
                    <Text style={styles.drawerItemArrow}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.drawerItem} onPress={toggleTheme}>
                    <Text style={styles.drawerItemIcon}>{isDark ? '☀️' : '🌙'}</Text>
                    <Text style={styles.drawerItemText}>{isDark ? 'Light mode' : 'Dark mode'}</Text>
                    <Text style={styles.drawerItemArrow}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.drawerItem} onPress={toggleDensity}>
                    <Text style={styles.drawerItemIcon}>{listDensity === 'compact' ? '🔍' : '📋'}</Text>
                    <Text style={styles.drawerItemText}>{listDensity === 'compact' ? 'Regular view' : 'Compact view'}</Text>
                    <Text style={styles.drawerItemArrow}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => openFromDrawer(setShowHelp)}>
                    <Text style={styles.drawerItemIcon}>❓</Text>
                    <Text style={styles.drawerItemText}>Help & Feedback</Text>
                    <Text style={styles.drawerItemArrow}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => openFromDrawer(setShowRate)}>
                    <Text style={styles.drawerItemIcon}>⭐</Text>
                    <Text style={styles.drawerItemText}>Rate Go Good</Text>
                    <Text style={styles.drawerItemArrow}>›</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
                  <Text style={styles.logoutText}>Log out</Text>
                </TouchableOpacity>
                <Text style={styles.drawerVersion}>Go Good v0.1 · made with 🌱 in NC</Text>
              </TouchableOpacity>
            </Animated.View>
          </TouchableOpacity>
        )}

        {/* ── Profile ── */}
        <BottomSheet visible={showProfile} onClose={() => setShowProfile(false)}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={styles.modalTitle}>Profile</Text>
              <TouchableOpacity onPress={() => setShowProfile(false)}><Text style={{ fontSize: 18, color: '#aaa' }}>✕</Text></TouchableOpacity>
            </View>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <TouchableOpacity onPress={pickProfilePhoto}>
                <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: '#E1F5EE', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {profilePhoto
                    ? <Image source={{ uri: profilePhoto }} style={{ width: 84, height: 84 }} />
                    : <Text style={{ fontSize: 36 }}>{profileName ? profileName[0].toUpperCase() : '👤'}</Text>
                  }
                </View>
                <View style={{ position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: '#085041', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 13 }}>📷</Text>
                </View>
              </TouchableOpacity>
              <Text style={{ fontSize: 10, color: '#aaa', marginTop: 6 }}>tap to change photo</Text>
            </View>
            <View style={{ flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12, marginBottom: 20 }}>
              {[
                { val: items.length, label: 'in storage', color: '#085041' },
                { val: stats.goneGood, label: 'gone good', color: '#1D9E75' },
                { val: stats.goneBad, label: 'gone bad', color: '#E24B4A' },
              ].map((s, i) => (
                <View key={s.label} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i > 0 ? 0.5 : 0, borderLeftColor: colors.border }}>
                  <Text style={{ fontSize: 22, fontWeight: '700', color: s.color }}>{s.val}</Text>
                  <Text style={{ fontSize: 9, color: colors.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{s.label}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput style={styles.input} placeholder="Your name" placeholderTextColor={colors.placeholder} value={profileName} onChangeText={setProfileName} />
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput style={styles.input} placeholder="your@email.com" placeholderTextColor={colors.placeholder} value={profileEmail} onChangeText={setProfileEmail} keyboardType="email-address" autoCapitalize="none" />
            <Text style={styles.fieldLabel}>Household size</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 10, padding: 11 }}>
              <Text style={{ fontSize: 14, color: colors.inputText }}>{householdSize} {householdSize === 1 ? 'person' : 'people'}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={[styles.qtyBtn, householdSize <= 1 && { backgroundColor: '#ccc' }]} onPress={() => setHouseholdSize(h => Math.max(1, h - 1))}>
                  <Text style={styles.qtyBtnText}>−</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.qtyBtn, householdSize >= 10 && { backgroundColor: '#ccc' }]} onPress={() => setHouseholdSize(h => Math.min(10, h + 1))}>
                  <Text style={styles.qtyBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.fieldLabel}>Dietary preferences</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
              {['Vegan', 'Vegetarian', 'Gluten-Free', 'Dairy-Free', 'Keto', 'Nut-Free', 'Halal', 'Kosher'].map(pref => {
                const on = dietaryPrefs.includes(pref);
                return (
                  <TouchableOpacity key={pref} onPress={() => setDietaryPrefs(prev => on ? prev.filter(p => p !== pref) : [...prev, pref])}
                    style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: on ? '#085041' : colors.surface, borderWidth: 1, borderColor: on ? '#085041' : colors.border }}>
                    <Text style={{ fontSize: 11, fontWeight: '500', color: on ? 'white' : colors.textSub }}>{pref}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={[styles.addConfirmBtn, { marginTop: 20 }]} onPress={saveProfile}>
              <Text style={styles.addConfirmText}>Save profile →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowProfile(false)}>
              <Text style={styles.cancelText}>cancel</Text>
            </TouchableOpacity>
            <View style={{ height: 20 }} />
          </ScrollView>
        </BottomSheet>

        {/* ── Notifications ── */}
        <BottomSheet visible={showNotifications} onClose={() => setShowNotifications(false)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={styles.modalTitle}>Notifications</Text>
            <TouchableOpacity onPress={() => setShowNotifications(false)}><Text style={{ fontSize: 18, color: '#aaa' }}>✕</Text></TouchableOpacity>
          </View>
          {[
            { key: 'expiry', val: notifExpiry, set: setNotifExpiry, title: 'Expiry alerts', sub: 'Get notified 3 days before items expire' },
            { key: 'digest', val: notifDigest, set: setNotifDigest, title: 'Daily digest', sub: 'Morning summary of what to use today' },
            { key: 'weekly', val: notifWeekly, set: setNotifWeekly, title: 'Weekly report', sub: 'See your food waste stats every Sunday' },
          ].map(n => (
            <View key={n.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text }}>{n.title}</Text>
                <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 2 }}>{n.sub}</Text>
              </View>
              <Switch value={n.val} onValueChange={n.set} trackColor={{ false: '#ddd', true: '#1D9E75' }} thumbColor="white" />
            </View>
          ))}
          <TouchableOpacity style={[styles.addConfirmBtn, { marginTop: 20 }]} onPress={saveNotifications}>
            <Text style={styles.addConfirmText}>Save →</Text>
          </TouchableOpacity>
        </BottomSheet>

        {/* ── Go Good Pro ── */}
        <BottomSheet visible={showPro} onClose={() => setShowPro(false)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={styles.modalTitle}>Go Good Pro 🌱</Text>
            <TouchableOpacity onPress={() => setShowPro(false)}><Text style={{ fontSize: 18, color: '#aaa' }}>✕</Text></TouchableOpacity>
          </View>
          <View style={{ backgroundColor: '#E1F5EE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: 16 }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: '#085041' }}>COMING SOON</Text>
          </View>
          {[
            { icon: '📷', title: 'Unlimited label scanning', sub: 'Scan as many items as you want' },
            { icon: '🤖', title: 'AI recipe suggestions', sub: 'Recipes based on what\'s about to expire' },
            { icon: '👨‍👩‍👧', title: 'Household sharing', sub: 'Share your inventory with family' },
            { icon: '📊', title: 'Waste analytics', sub: 'Track food and money saved over time' },
            { icon: '⚡', title: 'Priority support', sub: 'Get help fast when you need it' },
          ].map(f => (
            <View key={f.icon} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 22 }}>{f.icon}</Text>
              <View>
                <Text style={{ fontSize: 13, fontWeight: '500', color: colors.text }}>{f.title}</Text>
                <Text style={{ fontSize: 11, color: colors.textSub }}>{f.sub}</Text>
              </View>
            </View>
          ))}
          <TouchableOpacity style={[styles.addConfirmBtn, { marginTop: 20 }]} onPress={() => { showToast('Added to waitlist! 🌱'); setShowPro(false); }}>
            <Text style={styles.addConfirmText}>Join waitlist →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowPro(false)}>
            <Text style={styles.cancelText}>maybe later</Text>
          </TouchableOpacity>
        </BottomSheet>

        {/* ── Help & Feedback ── */}
        <BottomSheet visible={showHelp} onClose={() => setShowHelp(false)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={styles.modalTitle}>Help & Feedback</Text>
            <TouchableOpacity onPress={() => setShowHelp(false)}><Text style={{ fontSize: 18, color: '#aaa' }}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={[styles.fieldLabel, { marginTop: 0 }]}>FAQ</Text>
            {[
              { q: 'How do I add items?', a: 'Tap the + button in the top right. Fill in details manually or use 📷 scan label to auto-fill from a food package.' },
              { q: 'What do the badge colors mean?', a: 'Green = 6+ days left. Amber = 1–5 days. Red = expires today. Dark = already expired. Blue = frozen.' },
              { q: 'How does label scanning work?', a: 'When adding an item, tap 📷 scan label, take a photo of the packaging, and AI fills in the name, expiry, and macros automatically.' },
              { q: 'How do I mark something as used?', a: 'Tap any item to expand it, then tap ✓ gone good when used, or 🥀 gone bad if it went to waste.' },
              { q: 'Can I share with family?', a: 'Household sharing is coming in Go Good Pro. Join the waitlist from the Pro section in this menu.' },
              { q: 'How do I edit an item?', a: 'Expand the item by tapping it, then tap the ✏️ button to open the edit form.' },
            ].map((item, i) => (
              <TouchableOpacity key={i} onPress={() => setOpenFaq(openFaq === i ? null : i)} style={{ paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 13, fontWeight: '500', color: colors.text, flex: 1, paddingRight: 8 }}>{item.q}</Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>{openFaq === i ? '▲' : '▾'}</Text>
                </View>
                {openFaq === i && <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 8, lineHeight: 18 }}>{item.a}</Text>}
              </TouchableOpacity>
            ))}
            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Send Feedback</Text>
            <TouchableOpacity style={[styles.addConfirmBtn, { marginTop: 4 }]} onPress={() => Linking.openURL('mailto:support@gogood.app?subject=Go Good Feedback')}>
              <Text style={styles.addConfirmText}>✉️ Email us →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowHelp(false)}>
              <Text style={styles.cancelText}>close</Text>
            </TouchableOpacity>
            <View style={{ height: 20 }} />
          </ScrollView>
        </BottomSheet>

        {/* ── Rate Go Good ── */}
        <BottomSheet visible={showRate} onClose={() => setShowRate(false)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={styles.modalTitle}>Rate Go Good</Text>
            <TouchableOpacity onPress={() => setShowRate(false)}><Text style={{ fontSize: 18, color: '#aaa' }}>✕</Text></TouchableOpacity>
          </View>
          <Text style={{ fontSize: 13, color: '#6B6860', textAlign: 'center', marginBottom: 16 }}>Enjoying Go Good? Your rating helps us grow 🌱</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
            {[1,2,3,4,5].map(star => (
              <TouchableOpacity key={star} onPress={() => setRating(star)}>
                <Text style={{ fontSize: 36 }}>{star <= rating ? '⭐' : '☆'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {rating > 0 && (
            <>
              <TextInput style={[styles.input, { height: 80, textAlignVertical: 'top' }]} placeholder="Tell us what you think (optional)" placeholderTextColor={colors.placeholder} value={review} onChangeText={setReview} multiline />
              <TouchableOpacity style={[styles.addConfirmBtn, { marginTop: 12 }]} onPress={() => {
                if (rating === 5) Linking.openURL('https://apps.apple.com/app/id0000000000');
                showToast('Thanks for the feedback! 🌱');
                setShowRate(false); setRating(0); setReview('');
              }}>
                <Text style={styles.addConfirmText}>Submit →</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowRate(false)}>
            <Text style={styles.cancelText}>maybe later</Text>
          </TouchableOpacity>
        </BottomSheet>

        {/* ── Add / Edit ── */}
        <BottomSheet visible={showAdd} onClose={() => setShowAdd(false)}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 180 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text style={styles.modalTitle}>{editItem ? 'Edit item' : 'Add item'}</Text>
            </View>
            {!editItem && (
              <View style={styles.scanRow}>
                <TouchableOpacity style={[styles.scanBtn, styles.scanBtnBarcode]} onPress={openBarcodeScanner}>
                  <Text style={styles.scanBtnText}>📊 scan barcode</Text>
                </TouchableOpacity>
                <Animated.View style={{ flex: 1, opacity: scanPulse }}>
                  <TouchableOpacity style={[styles.scanBtn, { width: '100%' }]} onPress={scanLabel} disabled={scanning}>
                    <Text style={styles.scanBtnText}>{scanning ? '⏳ scanning...' : '📷 scan label'}</Text>
                  </TouchableOpacity>
                </Animated.View>
              </View>
            )}
            {!editItem && (
              <Text style={styles.scanHint}>Barcode fills name & macros · Label scan also reads expiry date</Text>
            )}
            <Text style={styles.fieldLabel}>Item name</Text>
            <TextInput style={styles.input} placeholder="e.g. Ribeye steak" placeholderTextColor={colors.placeholder} value={form.name} onChangeText={v => setForm(f => ({...f, name: v}))} returnKeyType="next" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Quantity</Text>
                <TextInput style={styles.input} placeholder="1" placeholderTextColor={colors.placeholder} value={form.qty} onChangeText={v => setForm(f => ({...f, qty: v}))} keyboardType="numeric" returnKeyType="next" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Unit</Text>
                <TextInput style={styles.input} placeholder="lbs" placeholderTextColor={colors.placeholder} value={form.unit} onChangeText={v => setForm(f => ({...f, unit: v}))} returnKeyType="next" />
              </View>
            </View>
            <Text style={styles.fieldLabel}>Expiry date (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} placeholder="2026-05-15" placeholderTextColor={colors.placeholder} value={form.expiryDate} onChangeText={v => setForm(f => ({...f, expiryDate: v}))} keyboardType="numbers-and-punctuation" returnKeyType="next" />
            <Text style={styles.fieldLabel}>Macros (per serving)</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {[{key:'protein',label:'Protein g'},{key:'carbs',label:'Carbs g'},{key:'fat',label:'Fat g'},{key:'cal',label:'Cal'}].map(m => (
                <View key={m.key} style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { fontSize: 8 }]}>{m.label}</Text>
                  <TextInput
                    style={[styles.input, { padding: 9 }]}
                    placeholder="0" placeholderTextColor={colors.placeholder}
                    value={(form as any)[m.key]}
                    onChangeText={v => setForm(f => ({...f, [m.key]: v}))}
                    keyboardType="numeric" returnKeyType="next"
                  />
                </View>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Location</Text>
            <View style={styles.categoryRow}>
              {(['fridge', 'freezer', 'pantry'] as const).map(cat => (
                <TouchableOpacity key={cat} style={[styles.categoryBtn, form.category === cat && styles.categoryBtnActive]} onPress={() => setForm(f => ({...f, category: cat}))}>
                  <Text style={[styles.categoryBtnText, form.category === cat && styles.categoryBtnTextActive]}>
                    {cat === 'fridge' ? '🥗' : cat === 'freezer' ? '❄️' : '🥫'} {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.addConfirmBtn} onPress={saveItem}>
              <Text style={styles.addConfirmText}>{editItem ? 'Save changes →' : `Add to ${form.category} →`}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdd(false)}>
              <Text style={styles.cancelText}>cancel</Text>
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        </BottomSheet>

        {/* ── Sort & Filter ── */}
        <BottomSheet visible={showSortFilter} onClose={() => setShowSortFilter(false)}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={styles.modalTitle}>Sort & Filter</Text>
              <TouchableOpacity onPress={() => setShowSortFilter(false)}><Text style={{ fontSize: 18, color: '#aaa' }}>✕</Text></TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Sort by</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {(Object.entries(SORT_LABELS) as [SortBy, string][]).map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
                    sortBy === key && { backgroundColor: '#085041', borderColor: '#085041' }
                  ]}
                  onPress={() => setSortBy(key)}
                >
                  <Text style={{ fontSize: 15 }}>{SORT_ICONS[key]}</Text>
                  <Text style={[{ fontSize: 12, color: colors.textSub, fontWeight: '500' }, sortBy === key && { color: 'white' }]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Filter by expiry</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {[
                { key: 'expired', emoji: '💀', label: 'Expired',    bg: ICON_BG.black, text: BADGE_SOFT.black.text },
                { key: 'today',   emoji: '🔴', label: 'Today',      bg: ICON_BG.red,   text: BADGE_SOFT.red.text   },
                { key: 'soon',    emoji: '🟡', label: '1–3 days',   bg: ICON_BG.amber, text: BADGE_SOFT.amber.text },
                { key: 'fresh',   emoji: '🟢', label: 'Fresh (4+)', bg: ICON_BG.green, text: BADGE_SOFT.green.text },
              ].map(e => (
                <TouchableOpacity
                  key={e.key}
                  style={[
                    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', backgroundColor: 'white' },
                    filterExpiry.includes(e.key) && { backgroundColor: e.bg, borderColor: 'transparent' }
                  ]}
                  onPress={() => setFilterExpiry(prev =>
                    prev.includes(e.key) ? prev.filter(x => x !== e.key) : [...prev, e.key]
                  )}
                >
                  <Text style={{ fontSize: 9 }}>{e.emoji}</Text>
                  <Text style={[{ fontSize: 12, color: '#6B6860', fontWeight: '500' }, filterExpiry.includes(e.key) && { color: e.text }]}>{e.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {availableFoodCats.length > 0 && (
              <>
                <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Filter by food category</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  <TouchableOpacity
                    style={[
                      { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
                      filterFoodCats.length === 0 && { backgroundColor: '#085041', borderColor: '#085041' }
                    ]}
                    onPress={() => setFilterFoodCats([])}
                  >
                    <Text style={[{ fontSize: 12, color: colors.textSub, fontWeight: '500' }, filterFoodCats.length === 0 && { color: 'white' }]}>All</Text>
                  </TouchableOpacity>
                  {availableFoodCats.map(cat => (
                    <TouchableOpacity
                      key={cat}
                      style={[
                        { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
                        filterFoodCats.includes(cat) && { backgroundColor: '#085041', borderColor: '#085041' }
                      ]}
                      onPress={() => setFilterFoodCats(prev =>
                        prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
                      )}
                    >
                      <Text style={[{ fontSize: 12, color: colors.textSub, fontWeight: '500' }, filterFoodCats.includes(cat) && { color: 'white' }]}>{cat}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <TouchableOpacity
              style={{ alignSelf: 'flex-start', marginTop: 12 }}
              onPress={() => { setFilterExpiry([]); setFilterFoodCats([]); }}
            >
              <Text style={{ fontSize: 12, color: colors.textMuted }}>clear all filters</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.addConfirmBtn, { marginTop: 24 }]} onPress={() => setShowSortFilter(false)}>
              <Text style={styles.addConfirmText}>Apply →</Text>
            </TouchableOpacity>
            <View style={{ height: 20 }} />
          </ScrollView>
        </BottomSheet>

        {/* ── Barcode Scanner ── */}
        <Modal visible={showBarcodeScanner} animationType="slide" onRequestClose={() => { setShowBarcodeScanner(false); setBarcodeScanned(false); setTimeout(() => setShowAdd(true), 300); }}>
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              facing="back"
              onBarcodeScanned={handleBarcodeScan}
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
            />
            {/* Viewfinder */}
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <View style={styles.barcodeFrame}>
                <View style={[styles.barcodeCorner, { top: -2, left: -2, borderTopWidth: 3, borderLeftWidth: 3 }]} />
                <View style={[styles.barcodeCorner, { top: -2, right: -2, borderTopWidth: 3, borderRightWidth: 3 }]} />
                <View style={[styles.barcodeCorner, { bottom: -2, left: -2, borderBottomWidth: 3, borderLeftWidth: 3 }]} />
                <View style={[styles.barcodeCorner, { bottom: -2, right: -2, borderBottomWidth: 3, borderRightWidth: 3 }]} />
                <Animated.View style={[styles.barcodeBeam, {
                  transform: [{ translateY: beamAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 156] }) }],
                  opacity:   beamAnim.interpolate({ inputRange: [0, 0.04, 0.96, 1], outputRange: [0, 1, 1, 0] }),
                }]} />
              </View>
              <Text style={{ color: 'white', marginTop: 20, fontSize: 14, fontWeight: '500' }}>
                Point at a barcode or QR code
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.5)', marginTop: 6, fontSize: 11 }}>
                UPC · EAN · Code128 supported
              </Text>
            </View>
            {/* Close */}
            <TouchableOpacity
              style={{ position: 'absolute', top: 60, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}
              onPress={() => { setShowBarcodeScanner(false); setBarcodeScanned(false); setTimeout(() => setShowAdd(true), 300); }}
            >
              <Text style={{ color: 'white', fontSize: 18, lineHeight: 22 }}>✕</Text>
            </TouchableOpacity>
            {/* Brand */}
            <View style={{ alignItems: 'center', paddingBottom: 48 }}>
              <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>powered by Open Food Facts</Text>
            </View>
            {/* Scan loading overlay */}
            {barcodeProcessing && (
              <Animated.View style={[styles.scanOverlay, { opacity: loadOverlayAnim }]}>
                {[0, 1, 2].map(i => (
                  <Animated.View key={i} style={[styles.scanRing, {
                    opacity: loadRingAnim.interpolate({ inputRange: [0, 0.3, 0.7, 1], outputRange: [0, 0.6, 0.2, 0] }),
                    transform: [{ scale: loadRingAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4 + i * 0.3, 1.4 + i * 0.3] }) }],
                  }]} />
                ))}
                <Animated.Text style={[styles.scanEmojiLarge, {
                  transform: [{ scale: loadEmojiAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.15, 1] }) }],
                }]}>{scannedEmoji}</Animated.Text>
                {scanSuccess === null && (
                  <Text style={styles.scanLoadingLabel}>looking up product…</Text>
                )}
                {scanSuccess === true && (
                  <Animated.View style={{ alignItems: 'center', gap: 6, opacity: loadResultAnim, transform: [{ translateY: loadResultAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
                    <Text style={styles.scanFoundCheck}>✓</Text>
                    <Text style={styles.scanFoundName}>{scannedName}</Text>
                  </Animated.View>
                )}
                {scanSuccess === false && (
                  <Animated.View style={{ alignItems: 'center', opacity: loadResultAnim }}>
                    <Text style={styles.scanNotFoundText}>not in database</Text>
                  </Animated.View>
                )}
              </Animated.View>
            )}
          </View>
        </Modal>

        {/* ── Expiring Detail ── */}
        <BottomSheet visible={showExpiringDetail} onClose={() => setShowExpiringDetail(false)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={styles.modalTitle}>Expiring Soon</Text>
            <TouchableOpacity onPress={() => setShowExpiringDetail(false)}><Text style={{ fontSize: 18, color: '#aaa' }}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {allExpiringSoon.length === 0 ? (
              <Text style={{ color: colors.textSub, textAlign: 'center', paddingVertical: 24 }}>Nothing expiring soon!</Text>
            ) : (
              [...allExpiringSoon].sort((a,b) => a.days - b.days).map(item => (
                <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border, gap: 12 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: ICON_BG[item.badge], alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 22 }}>{item.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>{item.baseName}</Text>
                    <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 2 }}>
                      {item.category.charAt(0).toUpperCase() + item.category.slice(1)} · {item.qty}
                    </Text>
                  </View>
                  <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: BADGE_SOFT[item.badge].bg }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: BADGE_SOFT[item.badge].text }}>{item.expires}</Text>
                  </View>
                </View>
              ))
            )}
            <View style={{ height: 20 }} />
          </ScrollView>
        </BottomSheet>

      </Animated.View>
    </SafeAreaView>
  );
}

function createStyles(c: ThemeColors, compact = false) { return StyleSheet.create({
  safeArea:              { flex: 1, backgroundColor: c.bg },
  container:             { flex: 1, backgroundColor: c.bg },
  blastWrap:             { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 },
  blastEmoji:            { position: 'absolute', fontSize: 14 },
  toast:                 { position: 'absolute', bottom: 110, alignSelf: 'center', backgroundColor: '#085041', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, zIndex: 100 },
  toastBad:              { backgroundColor: '#E24B4A' },
  toastText:             { color: 'white', fontSize: 11, fontWeight: '500' },

  // Header
  header:                { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, backgroundColor: c.bg },
  logo:                  { fontSize: 30, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
  logoGreen:             { color: c.teal, fontFamily: 'Fraunces_600SemiBold' },
  menuBtn:               { width: 32, height: 32, justifyContent: 'center', gap: 5 },
  menuLine:              { width: 20, height: 1.5, backgroundColor: c.text, borderRadius: 999 },
  expiringBadge:         { backgroundColor: '#FFEAEA', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  expiringBadgeText:     { fontSize: 11, fontWeight: '600', color: '#C0392B' },
  addBtn:                { width: 34, height: 34, borderRadius: 17, backgroundColor: '#085041', alignItems: 'center', justifyContent: 'center' },
  addBtnText:            { color: 'white', fontSize: 22, lineHeight: 26, fontWeight: '300' },

  // Search
  searchRow:             { paddingHorizontal: 16, paddingBottom: 10 },
  searchBar:             { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 0.5, borderColor: c.border, gap: 8 },
  searchIcon:            { fontSize: 15 },
  searchInput:           { flex: 1, fontSize: 14, color: c.text },

  // Tabs
  tabs:                  { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  tab:                   { flex: 1, paddingVertical: 10, borderRadius: 14, backgroundColor: c.surface, borderWidth: 0.5, borderColor: c.border, alignItems: 'center' },
  tabActive:             { backgroundColor: c.brand, borderColor: c.brand },
  tabText:               { fontSize: 12, fontWeight: '500', color: c.textSub },
  tabTextActive:         { color: 'white', fontWeight: '600' },

  // Macro bar
  macroBar:              { marginHorizontal: 16, marginBottom: compact ? 6 : 10, backgroundColor: c.surface, borderRadius: 14, borderWidth: 0.5, borderColor: c.border, padding: compact ? 8 : 14 },
  macroTitle:            { fontSize: compact ? 8 : 9, color: c.textSub, fontWeight: '700', letterSpacing: 1.2, marginBottom: compact ? 6 : 10 },
  macroRow:              { flexDirection: 'row', alignItems: 'center' },
  macroItem:             { flex: 1, flexDirection: 'row', alignItems: 'center' },
  macroItemInner:        { flex: 1, alignItems: 'center' },
  macroDivider:          { width: 0.5, height: compact ? 24 : 34, backgroundColor: c.border },
  macroNum:              { fontSize: compact ? 15 : 20, fontWeight: '700', color: c.text },
  macroLabel:            { fontSize: compact ? 7 : 8, color: c.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: compact ? 1 : 2 },

  // Sort bar
  sortBar:               { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  sortBarLeft:           { flex: 1, alignItems: 'flex-start' },
  sortBarRight:          { flex: 1, alignItems: 'flex-end' },
  sortBarLabel:          { fontSize: 10, fontWeight: '700', color: c.text, letterSpacing: 0.5 },
  sortFilterBtnText:     { fontSize: 12, color: c.teal, fontWeight: '600' },

  // Items
  scroll:                { flex: 1, paddingHorizontal: 16 },
  emptyState:            { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyIcon:             { fontSize: 48 },
  emptyTitle:            { fontSize: 16, fontWeight: '600', color: c.brand },
  emptySub:              { fontSize: 13, color: c.textSub },
  categoryHeader:        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 14, paddingBottom: 6 },
  categoryHeaderEmoji:   { fontSize: 14 },
  categoryHeaderText:    { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  categoryHeaderLine:    { flex: 1, height: 0.5 },
  categoryHeaderCount:   { fontSize: 10, fontWeight: '600' },

  // Item cards
  itemWrapMargin:        { height: compact ? 4 : 8 },
  itemCard:              { backgroundColor: c.surface, borderRadius: compact ? 12 : 16, borderWidth: 0.5, borderColor: c.border, overflow: 'hidden' },
  itemCardExpanded:      { borderColor: c.borderStrong },
  itemMain:              { flexDirection: 'row', alignItems: 'center', padding: compact ? 10 : 14, gap: compact ? 8 : 12 },
  iconWrap:              { width: compact ? 38 : 52, height: compact ? 38 : 52, borderRadius: compact ? 19 : 26, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  itemIcon:              { fontSize: compact ? 19 : 26 },
  itemInfo:              { flex: 1 },
  itemName:              { fontSize: compact ? 13 : 16, fontWeight: '600', color: c.text },
  batchInline:           { fontSize: compact ? 9 : 11, fontWeight: '400', color: c.textMuted },
  itemQty:               { fontSize: compact ? 9 : 11, color: c.textSub, marginTop: compact ? 1 : 3 },
  itemRight:             { alignItems: 'flex-end', gap: compact ? 2 : 4, flexShrink: 0 },
  badge:                 { paddingHorizontal: compact ? 7 : 10, paddingVertical: compact ? 3 : 5, borderRadius: 999 },
  badgeText:             { fontSize: compact ? 10 : 12, fontWeight: '500' },
  tapDetails:            { fontSize: compact ? 8 : 9, color: c.textMuted },

  // Item expanded
  itemDetail:            { paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: 0.5, borderTopColor: c.border, gap: 10, paddingTop: 12 },
  detailMacros:          { flexDirection: 'row', gap: 6 },
  macroPill:             { flex: 1, backgroundColor: c.bg, borderRadius: 10, padding: 8, alignItems: 'center' },
  macroPillNum:          { fontSize: 13, fontWeight: '600', color: c.brand },
  macroPillLabel:        { fontSize: 7, color: c.textSub, marginTop: 1, textTransform: 'uppercase' },
  qtyRow:                { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qtyLabel:              { fontSize: 10, color: c.textSub },
  qtyControls:           { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn:                { width: 26, height: 26, borderRadius: 13, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center' },
  qtyBtnText:            { color: 'white', fontSize: 18, lineHeight: 20 },
  qtyNum:                { fontSize: 13, fontWeight: '500', color: c.text, minWidth: 40, textAlign: 'center' },
  actionRow:             { flexDirection: 'row', gap: 6 },
  actionBtn:             { flex: 1, padding: 8, borderRadius: 10, backgroundColor: c.bg, borderWidth: 0.5, borderColor: c.border, alignItems: 'center' },
  actionUsed:            { backgroundColor: '#E1F5EE', borderColor: '#9FE1CB' },
  actionBad:             { backgroundColor: '#FAEEDA', borderColor: '#FAC775' },
  actionEdit:            { flex: 0, paddingHorizontal: 12, backgroundColor: '#E6F1FB', borderColor: '#B3D4F5' },
  actionDelete:          { flex: 0, paddingHorizontal: 12, backgroundColor: '#FCEBEB', borderColor: '#F7C1C1' },
  actionUsedText:        { fontSize: 10, color: '#085041', fontWeight: '500' },
  actionBadText:         { fontSize: 10, color: '#854F0B', fontWeight: '500' },
  actionEditText:        { fontSize: 12, color: '#185FA5' },
  actionDeleteText:      { fontSize: 12, color: '#A32D2D' },

  // Good Bot CTA
  goodBotWrapper:        { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  goodBotBtn:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#085041', padding: 16, borderRadius: 16 },
  goodBotLeft:           { flexDirection: 'row', alignItems: 'center', gap: 12 },
  goodBotAvatarWrap:     { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  goodBotText:           { color: 'white', fontSize: 13, fontWeight: '700' },
  goodBotSub:            { color: 'rgba(255,255,255,0.6)', fontSize: 10, marginTop: 2 },
  goodBotArrow:          { color: '#5DCAA5', fontSize: 20 },

  // Drawer
  drawerOverlay:         { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 50 },
  drawer:                { position: 'absolute', top: 0, left: 0, bottom: 0, width: 280, backgroundColor: c.drawerBg, paddingTop: 60, paddingHorizontal: 24, paddingBottom: 40 },
  drawerHeader:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  drawerLogo:            { fontSize: 26, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
  drawerLogoGreen:       { color: c.teal, fontFamily: 'Fraunces_600SemiBold' },
  drawerClose:           { width: 28, height: 28, borderRadius: 14, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  drawerCloseText:       { fontSize: 12, color: c.textSub },
  drawerSection:         { marginBottom: 28 },
  drawerSectionLabel:    { fontSize: 9, fontWeight: '600', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  drawerItem:            { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: c.border },
  drawerItemIcon:        { fontSize: 18, width: 24, textAlign: 'center' },
  drawerItemText:        { flex: 1, fontSize: 14, color: c.text, fontWeight: '400' },
  drawerItemArrow:       { fontSize: 18, color: c.textMuted },
  proBadge:              { backgroundColor: '#E1F5EE', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  proBadgeText:          { fontSize: 9, color: '#085041', fontWeight: '600' },
  logoutBtn:             { paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border, alignItems: 'center', marginTop: 8 },
  logoutText:            { fontSize: 14, color: '#E24B4A', fontWeight: '500' },
  drawerVersion:         { fontSize: 10, color: c.textMuted, textAlign: 'center', marginTop: 20 },

  // Modals
  modalTitle:            { fontSize: 16, fontWeight: '600', color: c.brand },
  fieldLabel:            { fontSize: 10, fontWeight: '600', color: c.textSub, textTransform: 'uppercase', letterSpacing: 1, marginTop: 10, marginBottom: 4 },
  input:                 { backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10, padding: 11, fontSize: 14, color: c.inputText },
  scanRow:               { flexDirection: 'row', gap: 8, marginBottom: 6, marginTop: 10 },
  scanBtn:               { flex: 1, backgroundColor: '#085041', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  scanBtnBarcode:        { backgroundColor: '#1D9E75' },
  scanBtnText:           { color: 'white', fontSize: 11, fontWeight: '600' },
  scanHint:              { fontSize: 10, color: c.textMuted, textAlign: 'center', marginBottom: 14 },
  barcodeFrame:          { width: 280, height: 160, borderRadius: 12, position: 'relative' },
  barcodeCorner:         { position: 'absolute', width: 24, height: 24, borderColor: '#5DCAA5', borderRadius: 2 },
  categoryRow:           { flexDirection: 'row', gap: 6, marginTop: 4 },
  categoryBtn:           { flex: 1, padding: 8, borderRadius: 8, backgroundColor: c.bg, borderWidth: 0.5, borderColor: c.border, alignItems: 'center' },
  categoryBtnActive:     { backgroundColor: '#085041', borderColor: '#085041' },
  categoryBtnText:       { fontSize: 10, fontWeight: '500', color: c.textSub },
  categoryBtnTextActive: { color: 'white' },
  addConfirmBtn:         { backgroundColor: '#1D9E75', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  addConfirmText:        { color: 'white', fontSize: 14, fontWeight: '600' },
  cancelBtn:             { alignItems: 'center', padding: 10 },
  cancelText:            { fontSize: 13, color: c.textMuted },

  // Overlays
  successOverlay:        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  successCircle:         { width: 88, height: 88, borderRadius: 44, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 10 },
  barcodeBeam:           { position: 'absolute', left: 4, right: 4, height: 2, backgroundColor: '#5DCAA5', shadowColor: '#5DCAA5', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 5 },

  // Scan loading overlay
  scanOverlay:           { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,80,65,0.96)', alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 10 },
  scanRing:              { position: 'absolute', width: 160, height: 160, borderRadius: 80, borderWidth: 2, borderColor: '#5DCAA5' },
  scanEmojiLarge:        { fontSize: 64, textAlign: 'center' },
  scanLoadingLabel:      { fontSize: 14, color: 'rgba(255,255,255,0.6)', letterSpacing: 0.5 },
  scanFoundCheck:        { fontSize: 36, color: '#5DCAA5', textAlign: 'center' },
  scanFoundName:         { fontSize: 16, color: 'white', fontWeight: '600', textAlign: 'center', paddingHorizontal: 24 },
  scanNotFoundText:      { fontSize: 14, color: '#E8756A', textAlign: 'center' },
}); }
