import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Animated, Modal, TextInput, KeyboardAvoidingView, Platform, Switch, Linking, Alert, Image, Dimensions, Easing, Keyboard, LayoutAnimation, UIManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { StatusBar } from 'expo-status-bar';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme, type ThemeColors } from '../context/theme';
import { useAuth } from '../context/auth';
import { requestNotificationPermission, rescheduleExpiryNotifications } from '../lib/notifications';
import { pushItems, pullItems, fromRow } from '../lib/sync';
import { HOUSEHOLD_KEY, HOUSEHOLD_NAME_KEY, subscribeToHouseholdItems } from '../lib/household';
import { useAppDrawer } from '../components/AppDrawer';
import { useSubscription } from '../context/subscription';
import { seedSampleItems } from '../lib/seed-items';

type Badge = 'red' | 'amber' | 'green' | 'blue' | 'black';
type Category = 'fridge' | 'freezer' | 'pantry';
type TabView  = 'fridge' | 'freezer' | 'pantry' | 'all';
type SortBy   = 'expiry' | 'expiryAsc' | 'alpha' | 'alphaDesc' | 'protein' | 'proteinAsc' | 'cal' | 'calAsc' | 'qty' | 'qtyAsc' | 'recent' | 'oldest' | 'category';

interface Item {
  id: number; icon: string; name: string; baseName: string; batch: number;
  qty: string; expiryDate: string; expires: string; badge: Badge; days: number;
  protein: number; carbs: number; fat: number; cal: number;
  qtyNum: number; unit: string; category: Category; addedAt: number;
  foodCategory?: string; servingSize?: string;
}

interface HistoryItem {
  id: string;
  name: string;
  icon: string;
  unit: string;
  category: Category;
  foodCategory: string;
  protein: number;
  carbs: number;
  fat: number;
  cal: number;
  servingSize?: string;
  savedAt: number;
}

const HISTORY_KEY = 'gogood_item_history';
const HISTORY_DAYS = 30;

const BADGE_SOFT_LIGHT: Record<Badge, { bg: string; text: string }> = {
  red:   { bg: '#FEEBEB', text: '#A52020' },
  amber: { bg: '#FFF8E6', text: '#7A4A00' },
  green: { bg: '#E1F5EE', text: '#0A5740' },
  blue:  { bg: '#EBF4FF', text: '#14428A' },
  black: { bg: '#2C2C2E', text: '#FFFFFF' },
};
const BADGE_SOFT_DARK: Record<Badge, { bg: string; text: string }> = {
  red:   { bg: 'rgba(245,90,90,0.2)',   text: '#F5A0A0' },
  amber: { bg: 'rgba(245,180,60,0.2)',  text: '#F5D090' },
  green: { bg: 'rgba(93,202,165,0.2)',  text: '#5DCAA5' },
  blue:  { bg: 'rgba(100,160,255,0.2)', text: '#90C0FF' },
  black: { bg: '#2C2C2E',              text: '#FFFFFF' },
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
  'default': '🥘',
};

const FOOD_CATEGORIES: Record<string, string> = {
  // Meat — longest-match first
  'ground beef': 'Meat', 'corned beef': 'Meat', 'short rib': 'Meat', 'rib eye': 'Meat',
  'hot dog': 'Meat', 'ribeye': 'Meat', 'steak': 'Meat', 'beef': 'Meat', 'brisket': 'Meat',
  'lamb chop': 'Meat', 'lamb': 'Meat', 'bison': 'Meat', 'veal': 'Meat',
  'meatball': 'Meat', 'meatloaf': 'Meat', 'pork chop': 'Meat', 'pork loin': 'Meat',
  'pork': 'Meat', 'bacon': 'Meat', 'ham': 'Meat', 'sausage': 'Meat',
  'prosciutto': 'Meat', 'chorizo': 'Meat', 'salami': 'Meat', 'pepperoni': 'Meat',
  'bratwurst': 'Meat', 'liverwurst': 'Meat', 'mortadella': 'Meat',
  'pastrami': 'Meat', 'bologna': 'Meat', 'venison': 'Meat', 'ribs': 'Meat',
  'tenderloin': 'Meat', 'sirloin': 'Meat', 'chuck': 'Meat', 'flank': 'Meat',
  'burger': 'Meat', 'hamburger': 'Meat', 'deli meat': 'Meat', 'lunch meat': 'Meat',
  'pancetta': 'Meat', 'guanciale': 'Meat', 'oxtail': 'Meat', 'bone broth': 'Meat',
  // Poultry
  'chicken breast': 'Poultry', 'chicken thigh': 'Poultry', 'chicken wing': 'Poultry',
  'chicken drumstick': 'Poultry', 'chicken tender': 'Poultry',
  'ground turkey': 'Poultry', 'turkey breast': 'Poultry', 'cornish hen': 'Poultry',
  'chicken': 'Poultry', 'turkey': 'Poultry', 'duck': 'Poultry',
  'quail': 'Poultry', 'goose': 'Poultry', 'pheasant': 'Poultry',
  // Fish & Seafood
  'smoked salmon': 'Fish & Seafood', 'canned tuna': 'Fish & Seafood', 'canned salmon': 'Fish & Seafood',
  'tuna can': 'Fish & Seafood', 'salmon can': 'Fish & Seafood', 'sardine can': 'Fish & Seafood',
  'tuna in water': 'Fish & Seafood', 'tuna in oil': 'Fish & Seafood',
  'salmon': 'Fish & Seafood', 'tuna': 'Fish & Seafood', 'tilapia': 'Fish & Seafood',
  'cod': 'Fish & Seafood', 'halibut': 'Fish & Seafood', 'trout': 'Fish & Seafood',
  'snapper': 'Fish & Seafood', 'swordfish': 'Fish & Seafood', 'catfish': 'Fish & Seafood',
  'herring': 'Fish & Seafood', 'sardine': 'Fish & Seafood', 'anchovy': 'Fish & Seafood',
  'mahi': 'Fish & Seafood', 'bass': 'Fish & Seafood', 'fish': 'Fish & Seafood',
  'shrimp': 'Fish & Seafood', 'prawn': 'Fish & Seafood', 'lobster': 'Fish & Seafood',
  'crab': 'Fish & Seafood', 'scallop': 'Fish & Seafood', 'oyster': 'Fish & Seafood',
  'clam': 'Fish & Seafood', 'mussel': 'Fish & Seafood', 'squid': 'Fish & Seafood',
  'octopus': 'Fish & Seafood', 'crawfish': 'Fish & Seafood', 'pollock': 'Fish & Seafood',
  'mackerel': 'Fish & Seafood', 'flounder': 'Fish & Seafood',
  // Dairy
  'cottage cheese': 'Dairy', 'cream cheese': 'Dairy', 'string cheese': 'Dairy',
  'greek yogurt': 'Dairy', 'oat milk': 'Dairy', 'almond milk': 'Dairy',
  'soy milk': 'Dairy', 'coconut milk': 'Dairy', 'half and half': 'Dairy',
  'heavy cream': 'Dairy', 'sour cream': 'Dairy', 'whipping cream': 'Dairy',
  'whipped cream': 'Dairy', 'lactose free milk': 'Dairy',
  'milk': 'Dairy', 'cheese': 'Dairy', 'butter': 'Dairy',
  'yogurt': 'Dairy', 'cream': 'Dairy',
  'cheddar': 'Dairy', 'mozzarella': 'Dairy', 'brie': 'Dairy',
  'gouda': 'Dairy', 'feta': 'Dairy', 'ricotta': 'Dairy',
  'provolone': 'Dairy', 'gruyere': 'Dairy', 'parmesan': 'Dairy',
  'swiss cheese': 'Dairy', 'american cheese': 'Dairy',
  'bocconcini': 'Dairy', 'quark': 'Dairy', 'buttermilk': 'Dairy',
  'kefir': 'Dairy', 'ghee': 'Dairy', 'margarine': 'Dairy',
  // Eggs
  'egg': 'Eggs', 'eggs': 'Eggs', 'large egg': 'Eggs', 'free range egg': 'Eggs',
  'cage free egg': 'Eggs', 'pasture raised egg': 'Eggs', 'organic egg': 'Eggs',
  'hard boiled egg': 'Eggs', 'liquid egg': 'Eggs', 'egg white': 'Eggs',
  'egg yolk': 'Eggs', 'whole egg': 'Eggs', 'dozen eggs': 'Eggs',
  // Vegetables
  'cherry tomato': 'Vegetables', 'sweet potato': 'Vegetables', 'sweet corn': 'Vegetables',
  'bell pepper': 'Vegetables', 'green bean': 'Vegetables', 'snap pea': 'Vegetables',
  'bok choy': 'Vegetables', 'brussels sprout': 'Vegetables', 'brussels': 'Vegetables',
  'broccoli': 'Vegetables', 'spinach': 'Vegetables', 'lettuce': 'Vegetables',
  'carrot': 'Vegetables', 'tomato': 'Vegetables', 'onion': 'Vegetables',
  'garlic': 'Vegetables', 'potato': 'Vegetables', 'corn': 'Vegetables',
  'cucumber': 'Vegetables', 'mushroom': 'Vegetables', 'avocado': 'Vegetables',
  'kale': 'Vegetables', 'zucchini': 'Vegetables', 'cauliflower': 'Vegetables',
  'cabbage': 'Vegetables', 'chard': 'Vegetables', 'collard': 'Vegetables',
  'arugula': 'Vegetables', 'celery': 'Vegetables',
  'artichoke': 'Vegetables', 'beet': 'Vegetables',
  'radish': 'Vegetables', 'turnip': 'Vegetables', 'parsnip': 'Vegetables',
  'leek': 'Vegetables', 'watercress': 'Vegetables', 'endive': 'Vegetables',
  'radicchio': 'Vegetables', 'jicama': 'Vegetables', 'kohlrabi': 'Vegetables',
  'asparagus': 'Vegetables', 'eggplant': 'Vegetables', 'squash': 'Vegetables',
  'yam': 'Vegetables', 'butternut': 'Vegetables', 'pumpkin': 'Vegetables',
  'jalapeño': 'Vegetables', 'jalapeno': 'Vegetables', 'poblano': 'Vegetables',
  'habanero': 'Vegetables', 'serrano': 'Vegetables', 'shallot': 'Vegetables',
  'pepper': 'Vegetables', 'okra': 'Vegetables', 'fennel': 'Vegetables',
  'microgreens': 'Vegetables', 'sprout': 'Vegetables',
  // Fruit
  'passion fruit': 'Fruit', 'dragon fruit': 'Fruit', 'star fruit': 'Fruit',
  'apple': 'Fruit', 'banana': 'Fruit', 'orange': 'Fruit', 'strawberry': 'Fruit', 'strawberries': 'Fruit',
  'blueberry': 'Fruit', 'blueberries': 'Fruit', 'grape': 'Fruit', 'mango': 'Fruit', 'peach': 'Fruit', 'peaches': 'Fruit',
  'watermelon': 'Fruit', 'cantaloupe': 'Fruit', 'honeydew': 'Fruit',
  'pear': 'Fruit', 'cherry': 'Fruit', 'cherries': 'Fruit', 'kiwi': 'Fruit', 'pomegranate': 'Fruit',
  'fig': 'Fruit', 'apricot': 'Fruit', 'apricots': 'Fruit', 'nectarine': 'Fruit', 'nectarines': 'Fruit', 'plum': 'Fruit', 'plums': 'Fruit',
  'guava': 'Fruit', 'papaya': 'Fruit', 'lychee': 'Fruit', 'coconut': 'Fruit',
  'lime': 'Fruit', 'lemon': 'Fruit', 'lemons': 'Fruit', 'limes': 'Fruit', 'grapefruit': 'Fruit', 'clementine': 'Fruit',
  'mandarin': 'Fruit', 'tangerine': 'Fruit', 'cranberry': 'Fruit', 'cranberries': 'Fruit',
  'blackberry': 'Fruit', 'blackberries': 'Fruit', 'raspberry': 'Fruit', 'raspberries': 'Fruit',
  'pineapple': 'Fruit', 'date': 'Fruit', 'raisin': 'Fruit', 'raisins': 'Fruit',
  'dried mango': 'Fruit', 'dried apricot': 'Fruit', 'dried cranberry': 'Fruit',
  // Legumes & Beans
  'black bean': 'Legumes & Beans', 'kidney bean': 'Legumes & Beans',
  'pinto bean': 'Legumes & Beans', 'navy bean': 'Legumes & Beans',
  'cannellini bean': 'Legumes & Beans', 'great northern bean': 'Legumes & Beans',
  'green lentil': 'Legumes & Beans', 'red lentil': 'Legumes & Beans',
  'chickpea': 'Legumes & Beans', 'garbanzo': 'Legumes & Beans',
  'bean': 'Legumes & Beans', 'lentil': 'Legumes & Beans',
  'edamame': 'Legumes & Beans', 'pea': 'Legumes & Beans',
  'tofu': 'Legumes & Beans', 'tempeh': 'Legumes & Beans', 'miso': 'Legumes & Beans',
  'hummus': 'Legumes & Beans', 'falafel': 'Legumes & Beans',
  'split pea': 'Legumes & Beans', 'black-eyed pea': 'Legumes & Beans',
  'soybean': 'Legumes & Beans', 'refried beans': 'Legumes & Beans',
  // Nuts & Seeds
  'almond butter': 'Nuts & Seeds', 'cashew butter': 'Nuts & Seeds',
  'sunflower seed': 'Nuts & Seeds', 'pumpkin seed': 'Nuts & Seeds',
  'chia seed': 'Nuts & Seeds', 'flax seed': 'Nuts & Seeds', 'hemp seed': 'Nuts & Seeds',
  'sesame seed': 'Nuts & Seeds', 'poppy seed': 'Nuts & Seeds',
  'peanut butter': 'Nuts & Seeds', 'almond': 'Nuts & Seeds', 'cashew': 'Nuts & Seeds',
  'walnut': 'Nuts & Seeds', 'pecan': 'Nuts & Seeds', 'pistachio': 'Nuts & Seeds',
  'macadamia': 'Nuts & Seeds', 'hazelnut': 'Nuts & Seeds', 'pine nut': 'Nuts & Seeds',
  'brazil nut': 'Nuts & Seeds', 'peanut': 'Nuts & Seeds', 'nut': 'Nuts & Seeds',
  'tahini': 'Nuts & Seeds', 'seed': 'Nuts & Seeds',
  // Bread & Grains
  'english muffin': 'Bread & Grains', 'whole wheat bread': 'Bread & Grains',
  'white bread': 'Bread & Grains', 'brown rice': 'Bread & Grains',
  'wild rice': 'Bread & Grains', 'jasmine rice': 'Bread & Grains',
  'bread': 'Bread & Grains', 'pasta': 'Bread & Grains', 'rice': 'Bread & Grains',
  'oat': 'Bread & Grains', 'oatmeal': 'Bread & Grains', 'cereal': 'Bread & Grains',
  'tortilla': 'Bread & Grains', 'sourdough': 'Bread & Grains', 'baguette': 'Bread & Grains',
  'bagel': 'Bread & Grains', 'pita': 'Bread & Grains', 'naan': 'Bread & Grains',
  'flatbread': 'Bread & Grains', 'wrap': 'Bread & Grains', 'brioche': 'Bread & Grains',
  'rye': 'Bread & Grains', 'pumpernickel': 'Bread & Grains',
  'spaghetti': 'Bread & Grains', 'fettuccine': 'Bread & Grains', 'penne': 'Bread & Grains',
  'rigatoni': 'Bread & Grains', 'linguine': 'Bread & Grains', 'orzo': 'Bread & Grains',
  'couscous': 'Bread & Grains', 'quinoa': 'Bread & Grains', 'barley': 'Bread & Grains',
  'farro': 'Bread & Grains', 'bulgur': 'Bread & Grains', 'granola': 'Bread & Grains',
  'noodle': 'Bread & Grains', 'ramen': 'Bread & Grains', 'udon': 'Bread & Grains',
  'soba': 'Bread & Grains', 'muffin': 'Bread & Grains', 'roll': 'Bread & Grains',
  'bun': 'Bread & Grains', 'croissant': 'Bread & Grains', 'crumpet': 'Bread & Grains',
  'waffle': 'Bread & Grains', 'pancake': 'Bread & Grains',
  // Canned & Jarred
  'canned tomato': 'Canned & Jarred', 'diced tomato': 'Canned & Jarred',
  'crushed tomato': 'Canned & Jarred', 'tomato paste': 'Canned & Jarred',
  'tomato sauce': 'Canned & Jarred', 'marinara': 'Canned & Jarred',
  'pasta sauce': 'Canned & Jarred', 'canned corn': 'Canned & Jarred',
  'canned pumpkin': 'Canned & Jarred', 'canned fruit': 'Canned & Jarred',
  'chicken broth': 'Canned & Jarred', 'beef broth': 'Canned & Jarred',
  'vegetable broth': 'Canned & Jarred', 'chicken stock': 'Canned & Jarred',
  'beef stock': 'Canned & Jarred', 'broth': 'Canned & Jarred', 'stock': 'Canned & Jarred',
  'soup': 'Canned & Jarred', 'condensed soup': 'Canned & Jarred',
  'coconut cream': 'Canned & Jarred',
  'pickle': 'Canned & Jarred', 'caper': 'Canned & Jarred', 'olive': 'Canned & Jarred',
  'jarred pepper': 'Canned & Jarred', 'artichoke heart': 'Canned & Jarred',
  'sun-dried tomato': 'Canned & Jarred', 'roasted red pepper': 'Canned & Jarred',
  'applesauce': 'Canned & Jarred', 'fruit cup': 'Canned & Jarred',
  // Baking
  'all purpose flour': 'Baking', 'bread flour': 'Baking', 'almond flour': 'Baking',
  'coconut flour': 'Baking', 'whole wheat flour': 'Baking',
  'brown sugar': 'Baking', 'powdered sugar': 'Baking', 'coconut sugar': 'Baking',
  'chocolate chip': 'Baking', 'cocoa powder': 'Baking', 'cacao': 'Baking',
  'baking powder': 'Baking', 'baking soda': 'Baking', 'active dry yeast': 'Baking',
  'instant yeast': 'Baking', 'yeast': 'Baking', 'cornstarch': 'Baking',
  'corn starch': 'Baking', 'vanilla extract': 'Baking', 'almond extract': 'Baking',
  'vanilla': 'Baking', 'cream of tartar': 'Baking', 'gelatin': 'Baking',
  'flour': 'Baking', 'cornmeal': 'Baking', 'sugar': 'Baking',
  'shortening': 'Baking', 'lard': 'Baking',
  // Condiments & Sauces
  'soy sauce': 'Condiments & Sauces', 'olive oil': 'Condiments & Sauces',
  'coconut oil': 'Condiments & Sauces', 'avocado oil': 'Condiments & Sauces',
  'sesame oil': 'Condiments & Sauces', 'canola oil': 'Condiments & Sauces',
  'vegetable oil': 'Condiments & Sauces', 'hot sauce': 'Condiments & Sauces',
  'fish sauce': 'Condiments & Sauces', 'oyster sauce': 'Condiments & Sauces',
  'ketchup': 'Condiments & Sauces', 'mustard': 'Condiments & Sauces',
  'dijon mustard': 'Condiments & Sauces', 'honey mustard': 'Condiments & Sauces',
  'mayo': 'Condiments & Sauces', 'mayonnaise': 'Condiments & Sauces',
  'salsa': 'Condiments & Sauces', 'dressing': 'Condiments & Sauces',
  'relish': 'Condiments & Sauces', 'teriyaki': 'Condiments & Sauces',
  'worcestershire': 'Condiments & Sauces', 'hoisin': 'Condiments & Sauces',
  'pesto': 'Condiments & Sauces', 'aioli': 'Condiments & Sauces',
  'guacamole': 'Condiments & Sauces', 'ranch': 'Condiments & Sauces',
  'caesar dressing': 'Condiments & Sauces', 'balsamic': 'Condiments & Sauces',
  'vinegar': 'Condiments & Sauces', 'sriracha': 'Condiments & Sauces',
  'buffalo sauce': 'Condiments & Sauces', 'bbq sauce': 'Condiments & Sauces',
  'chili sauce': 'Condiments & Sauces', 'stir fry sauce': 'Condiments & Sauces',
  'jam': 'Condiments & Sauces', 'jelly': 'Condiments & Sauces',
  // Syrups & Sweeteners
  'vanilla syrup': 'Syrups & Sweeteners', 'hazelnut syrup': 'Syrups & Sweeteners',
  'caramel syrup': 'Syrups & Sweeteners', 'pumpkin spice syrup': 'Syrups & Sweeteners',
  'lavender syrup': 'Syrups & Sweeteners', 'brown sugar syrup': 'Syrups & Sweeteners',
  'simple syrup': 'Syrups & Sweeteners', 'coffee syrup': 'Syrups & Sweeteners',
  'flavored syrup': 'Syrups & Sweeteners', 'torani': 'Syrups & Sweeteners',
  'monin': 'Syrups & Sweeteners', 'maple syrup': 'Syrups & Sweeteners',
  'corn syrup': 'Syrups & Sweeteners', 'golden syrup': 'Syrups & Sweeteners',
  'date syrup': 'Syrups & Sweeteners', 'agave syrup': 'Syrups & Sweeteners',
  'brown rice syrup': 'Syrups & Sweeteners', 'coconut nectar': 'Syrups & Sweeteners',
  'treacle': 'Syrups & Sweeteners', 'molasses': 'Syrups & Sweeteners',
  'honey': 'Syrups & Sweeteners', 'agave': 'Syrups & Sweeteners',
  'syrup': 'Syrups & Sweeteners', 'sweetener': 'Syrups & Sweeteners',
  'stevia': 'Syrups & Sweeteners', 'monk fruit': 'Syrups & Sweeteners',
  // Drinks
  'orange juice': 'Drinks', 'apple juice': 'Drinks', 'grape juice': 'Drinks',
  'cranberry juice': 'Drinks', 'coconut water': 'Drinks', 'sparkling water': 'Drinks',
  'protein shake': 'Drinks', 'energy drink': 'Drinks', 'sports drink': 'Drinks',
  'juice': 'Drinks', 'wine': 'Drinks', 'beer': 'Drinks', 'cider': 'Drinks',
  'hard seltzer': 'Drinks', 'kombucha': 'Drinks', 'smoothie': 'Drinks',
  'lemonade': 'Drinks', 'limeade': 'Drinks', 'soda': 'Drinks',
  'seltzer': 'Drinks', 'tonic water': 'Drinks', 'club soda': 'Drinks',
  'water': 'Drinks', 'milk alternative': 'Drinks',
  // Coffee & Tea
  'coffee bean': 'Coffee & Tea', 'ground coffee': 'Coffee & Tea',
  'instant coffee': 'Coffee & Tea', 'k-cup': 'Coffee & Tea', 'kcup': 'Coffee & Tea',
  'coffee pod': 'Coffee & Tea', 'espresso pod': 'Coffee & Tea',
  'nespresso': 'Coffee & Tea', 'keurig': 'Coffee & Tea',
  'tea bag': 'Coffee & Tea', 'loose leaf tea': 'Coffee & Tea',
  'matcha powder': 'Coffee & Tea', 'chai concentrate': 'Coffee & Tea',
  'cold brew concentrate': 'Coffee & Tea', 'coffee grounds': 'Coffee & Tea',
  'decaf': 'Coffee & Tea', 'cold brew': 'Coffee & Tea',
  'green tea': 'Coffee & Tea', 'herbal tea': 'Coffee & Tea',
  'chamomile tea': 'Coffee & Tea', 'chamomile': 'Coffee & Tea',
  'peppermint tea': 'Coffee & Tea', 'ginger tea': 'Coffee & Tea',
  'lavender tea': 'Coffee & Tea', 'rooibos': 'Coffee & Tea',
  'black tea': 'Coffee & Tea', 'oolong tea': 'Coffee & Tea', 'white tea': 'Coffee & Tea',
  'coffee': 'Coffee & Tea', 'espresso': 'Coffee & Tea', 'tea': 'Coffee & Tea',
  'matcha': 'Coffee & Tea', 'chai': 'Coffee & Tea',
  // Snacks & Sweets
  'potato chip': 'Snacks & Sweets', 'corn chip': 'Snacks & Sweets',
  'licorice': 'Snacks & Sweets', 'granola bar': 'Snacks & Sweets',
  'protein bar': 'Snacks & Sweets', 'energy bar': 'Snacks & Sweets',
  'trail mix': 'Snacks & Sweets', 'dark chocolate': 'Snacks & Sweets',
  'milk chocolate': 'Snacks & Sweets', 'white chocolate': 'Snacks & Sweets',
  'fruit snack': 'Snacks & Sweets', 'chocolate bar': 'Snacks & Sweets',
  'chocolate': 'Snacks & Sweets', 'cookie': 'Snacks & Sweets',
  'cake': 'Snacks & Sweets', 'pie': 'Snacks & Sweets',
  'popcorn': 'Snacks & Sweets', 'chips': 'Snacks & Sweets', 'pretzel': 'Snacks & Sweets',
  'cracker': 'Snacks & Sweets', 'jerky': 'Snacks & Sweets', 'gummy': 'Snacks & Sweets',
  'candy': 'Snacks & Sweets', 'brownie': 'Snacks & Sweets', 'donut': 'Snacks & Sweets',
  'cupcake': 'Snacks & Sweets', 'pudding': 'Snacks & Sweets',
  'wafer': 'Snacks & Sweets', 'fruit roll': 'Snacks & Sweets',
  'rice cake': 'Snacks & Sweets', 'cheese puff': 'Snacks & Sweets',
  'pork rind': 'Snacks & Sweets', 'nachos': 'Snacks & Sweets',
  'tortilla chip': 'Snacks & Sweets', 'veggie chip': 'Snacks & Sweets',
  'veggie straw': 'Snacks & Sweets', 'rice cracker': 'Snacks & Sweets',
  'cheese cracker': 'Snacks & Sweets', 'animal cracker': 'Snacks & Sweets',
  'graham cracker': 'Snacks & Sweets', 'peanut butter cup': 'Snacks & Sweets',
  'fruit leather': 'Snacks & Sweets', 'dried fruit': 'Snacks & Sweets',
  'puffed rice': 'Snacks & Sweets', 'popcorn cake': 'Snacks & Sweets',
  'kettle corn': 'Snacks & Sweets', 'beef jerky': 'Snacks & Sweets',
  'turkey jerky': 'Snacks & Sweets', 'meat stick': 'Snacks & Sweets',
  'slim jim': 'Snacks & Sweets', 'cheese stick': 'Snacks & Sweets',
  'string cheese': 'Snacks & Sweets', 'babybel': 'Snacks & Sweets',
  'yogurt cup': 'Snacks & Sweets', 'applesauce pouch': 'Snacks & Sweets',
  'nut bar': 'Snacks & Sweets', 'larabar': 'Snacks & Sweets', 'rxbar': 'Snacks & Sweets',
  'kind bar': 'Snacks & Sweets', 'clif bar': 'Snacks & Sweets',
  'nutter butter': 'Snacks & Sweets', 'oreo': 'Snacks & Sweets',
  'chips ahoy': 'Snacks & Sweets', 'cheeto': 'Snacks & Sweets',
  'dorito': 'Snacks & Sweets', 'lays': 'Snacks & Sweets', 'ruffles': 'Snacks & Sweets',
  'pringles': 'Snacks & Sweets', 'goldfish': 'Snacks & Sweets',
  'wheat thin': 'Snacks & Sweets', 'triscuit': 'Snacks & Sweets',
  'snack mix': 'Snacks & Sweets', 'chex mix': 'Snacks & Sweets',
  // Frozen Foods
  'frozen pizza': 'Frozen Foods', 'frozen meal': 'Frozen Foods',
  'frozen burrito': 'Frozen Foods', 'frozen dinner': 'Frozen Foods',
  'frozen lasagna': 'Frozen Foods', 'frozen chicken': 'Frozen Foods',
  'frozen fish': 'Frozen Foods', 'frozen shrimp': 'Frozen Foods',
  'frozen vegetable': 'Frozen Foods', 'frozen veggie': 'Frozen Foods',
  'frozen fruit': 'Frozen Foods', 'frozen berry': 'Frozen Foods',
  'frozen berries': 'Frozen Foods', 'frozen mango': 'Frozen Foods',
  'frozen broccoli': 'Frozen Foods', 'frozen spinach': 'Frozen Foods',
  'frozen peas': 'Frozen Foods', 'frozen corn': 'Frozen Foods',
  'frozen edamame': 'Frozen Foods', 'frozen waffle': 'Frozen Foods',
  'frozen pancake': 'Frozen Foods', 'frozen biscuit': 'Frozen Foods',
  'toaster waffle': 'Frozen Foods', 'eggo': 'Frozen Foods',
  'tater tot': 'Frozen Foods', 'frozen fries': 'Frozen Foods',
  'french fry': 'Frozen Foods', 'fish stick': 'Frozen Foods',
  'chicken nugget': 'Frozen Foods', 'corn dog': 'Frozen Foods',
  'veggie burger': 'Frozen Foods', 'hot pocket': 'Frozen Foods',
  'pot pie': 'Frozen Foods', 'tv dinner': 'Frozen Foods',
  'ice cream': 'Frozen Foods', 'frozen yogurt': 'Frozen Foods',
  'sorbet': 'Frozen Foods', 'popsicle': 'Frozen Foods', 'gelato': 'Frozen Foods',
  // Prepared & Deli
  'rotisserie chicken': 'Prepared & Deli', 'deli salad': 'Prepared & Deli',
  'prepared meal': 'Prepared & Deli', 'heat and eat': 'Prepared & Deli',
  'ready to eat': 'Prepared & Deli', 'meal kit': 'Prepared & Deli',
  'ready meal': 'Prepared & Deli', 'mac and cheese': 'Prepared & Deli',
  'macaroni and cheese': 'Prepared & Deli', 'hello fresh': 'Prepared & Deli',
  'blue apron': 'Prepared & Deli', 'deli': 'Prepared & Deli',
  'pre-made': 'Prepared & Deli', 'party platter': 'Prepared & Deli',
  'cooked chicken': 'Prepared & Deli', 'smoked brisket': 'Prepared & Deli',
  // Supplements
  'protein powder': 'Supplements', 'whey protein': 'Supplements',
  'whey': 'Supplements', 'creatine': 'Supplements',
  'multivitamin': 'Supplements', 'fish oil': 'Supplements',
  'omega 3': 'Supplements', 'collagen': 'Supplements',
  'collagen peptide': 'Supplements', 'probiotic': 'Supplements',
  'greens powder': 'Supplements', 'super greens': 'Supplements',
  'bcaa': 'Supplements', 'pre-workout': 'Supplements', 'preworkout': 'Supplements',
  'electrolyte': 'Supplements', 'vitamin c': 'Supplements',
  'vitamin d': 'Supplements', 'zinc': 'Supplements', 'magnesium': 'Supplements',
  'iron supplement': 'Supplements', 'calcium': 'Supplements',
  'vitamin': 'Supplements', 'supplement': 'Supplements',
  // Leftovers
  'leftover': 'Leftovers', 'leftovers': 'Leftovers',
  // Herbs & Spices
  'fennel seed': 'Herbs & Spices', 'bay leaf': 'Herbs & Spices', 'lemongrass': 'Herbs & Spices',
  'fresh basil': 'Herbs & Spices', 'fresh cilantro': 'Herbs & Spices',
  'basil': 'Herbs & Spices', 'cilantro': 'Herbs & Spices', 'parsley': 'Herbs & Spices',
  'dill': 'Herbs & Spices', 'mint': 'Herbs & Spices', 'thyme': 'Herbs & Spices',
  'rosemary': 'Herbs & Spices', 'oregano': 'Herbs & Spices', 'sage': 'Herbs & Spices',
  'chive': 'Herbs & Spices', 'tarragon': 'Herbs & Spices', 'curry': 'Herbs & Spices',
  'cumin': 'Herbs & Spices', 'paprika': 'Herbs & Spices', 'cayenne': 'Herbs & Spices',
  'cinnamon': 'Herbs & Spices', 'nutmeg': 'Herbs & Spices', 'cardamom': 'Herbs & Spices',
  'allspice': 'Herbs & Spices', 'anise': 'Herbs & Spices', 'turmeric': 'Herbs & Spices',
  'ginger': 'Herbs & Spices', 'salt': 'Herbs & Spices', 'pepper flake': 'Herbs & Spices',
  'chili powder': 'Herbs & Spices', 'garlic powder': 'Herbs & Spices',
  'onion powder': 'Herbs & Spices', 'smoked paprika': 'Herbs & Spices',
  'italian seasoning': 'Herbs & Spices', 'seasoning': 'Herbs & Spices',
  'spice': 'Herbs & Spices', 'herb': 'Herbs & Spices', 'saffron': 'Herbs & Spices',
  'clove': 'Herbs & Spices', 'star anise': 'Herbs & Spices', 'coriander': 'Herbs & Spices',
};

function getIcon(name: string): string {
  const lower = name.toLowerCase();

  // Tier 1 — product-type wins over any ingredient/flavour match.
  // "Blueberry Pomegranate Drink" → 🧃, not 🍎 (pomegranate).
  if (/\b(juice|drink|beverage|punch|nectar|cocktail|lemonade|limeade|agua fresca|agua)\b/.test(lower)) return '🧃';
  if (/\b(smoothie|shake)\b/.test(lower)) return '🥤';
  if (/\b(soda|cola|\bpop\b|sparkling water|seltzer|tonic water|club soda)\b/.test(lower)) return '🥤';
  if (/\b(energy drink|sports drink)\b/.test(lower)) return '🥤';
  if (/\b(coffee|espresso|cold brew|latte|cappuccino|americano|macchiato)\b/.test(lower)) return '☕';
  if (/\b(tea\b|matcha|kombucha|chai\b)\b/.test(lower)) return '🍵';
  if (/\b(beer\b|ale\b|lager\b|stout\b|porter\b|ipa\b|hard seltzer)\b/.test(lower)) return '🍺';
  if (/\b(wine\b|rosé|champagne|prosecco|cava|merlot|cabernet|chardonnay)\b/.test(lower)) return '🍷';
  if (/\bwater\b/.test(lower) && !/\bwatermelon\b/.test(lower)) return '💧';
  if (/\b(ice cream|frozen yogurt|sorbet|gelato|popsicle|ice pop)\b/.test(lower)) return '🍦';
  if (/\b(yogurt|kefir)\b/.test(lower)) return '🥛';
  if (/\b(granola bar|protein bar|energy bar|snack bar|nut.*bar|fruit.*bar)\b/.test(lower)) return '🍫';
  if (/\b(cookie|cookies|biscuit)\b/.test(lower)) return '🍪';
  if (/\b(candy|gummies|gummy|caramel)\b/.test(lower)) return '🍬';
  if (/\b(cereal|granola|oatmeal|\boats\b)\b/.test(lower)) return '🥣';
  if (/\b(pizza)\b/.test(lower)) return '🍕';
  if (/\b(soup\b|stew\b|chili\b|bisque)\b/.test(lower)) return '🍲';

  // Tier 2 — longest-key ingredient match (existing behaviour).
  const sorted = Object.entries(FOOD_ICONS).sort((a, b) => b[0].length - a[0].length);
  for (const [key, icon] of sorted) {
    if (key !== 'default' && lower.includes(key)) return icon;
  }
  return FOOD_ICONS.default;
}

// All food & drink emojis, for the manual icon picker in the add/edit sheet.
const FOOD_EMOJIS: string[] = [
  // Fruits
  '🍏','🍎','🍐','🍊','🍋','🍋‍🟩','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝',
  // Vegetables
  '🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🫘','🥜','🫛','🍄','🍄‍🟫','🫚','🌰','🫜',
  // Bread, grains & prepared
  '🍞','🥐','🥖','🫓','🥨','🥯','🥞','🧇','🍳','🧈','🍚','🍘','🍙','🍛','🍜','🍝','🍠','🥣','🥗','🍲','🫕','🥘','🍿','🧆','🥫','🫙','🥟','🥡',
  // Protein & mains
  '🍖','🍗','🥩','🥓','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🫔','🥙','🥚','🦴',
  // Seafood
  '🦪','🦐','🦞','🦀','🦑','🐙','🐟','🐠','🐡','🍤','🍣','🍱',
  // Dairy & eggs
  '🥛','🧀','🥚','🍳','🍦','🍨',
  // Sweets & desserts
  '🍧','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍩','🍪','🌰','🍯',
  // Drinks
  '🍼','🫗','☕','🫖','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾','🧊','💧',
  // Misc / staples
  '🧂','🥢','🍴','🥄','🔪','🧊','🌾','🍃',
];

function getFoodCategory(name: string): string {
  // Strip packing/liquid descriptors so "tuna in water" → "tuna", etc.
  const lower = name.toLowerCase()
    .replace(/\bin (water|oil|brine|juice|syrup|sauce|tomato sauce|olive oil|broth|gravy|cream)\b/g, '')
    .replace(/\b(packed in|marinated in|preserved in)\b/g, '')
    .replace(/\s+/g, ' ').trim();

  // Strip origin/quality qualifiers that don't change the food type so
  // "organic grass-fed ground beef" → "ground beef", "wild-caught atlantic salmon" → "salmon", etc.
  const QUALIFIERS = /\b(organic|natural|fresh|raw|wild|wild-caught|farm-raised|grass-fed|grass fed|free-range|free range|pasture-raised|hormone-free|antibiotic-free|non-gmo|locally sourced|whole|sliced|diced|chopped|minced|shredded|grated|cubed|crushed|pureed|mashed|baked|roasted|grilled|steamed|air-fried|slow-cooked|smoked|cured|aged|marinated|seasoned|spiced|flavored|infused|reduced fat|low fat|fat free|full fat|light|extra|mild|medium|sharp|premium|artisan|artisanal|homemade|traditional|authentic|gourmet|imported|local|certified|lean|extra lean|boneless|bone-in|skin-on|skinless|peeled|deveined|cleaned|trimmed|halved|quartered|regular|plain|original|classic|xl|large|small|mini|baby|giant|jumbo|petite|thin|thick|atlantic|pacific|alaskan|norwegian|canadian|italian|french|greek|japanese|korean|mexican|spanish|thai|chinese|american|british|european)\b/g;
  const stripped = lower.replace(QUALIFIERS, '').replace(/\s+/g, ' ').trim();

  const sorted = Object.entries(FOOD_CATEGORIES).sort((a, b) => b[0].length - a[0].length);

  // Word-boundary match: key must not be preceded or followed by a letter.
  // Prevents "ham" matching "chamomile", "egg" matching "eggplant", etc.
  const wordMatch = (text: string, key: string): boolean => {
    const idx = text.indexOf(key);
    if (idx === -1) return false;
    const before = idx === 0 || !/[a-z]/.test(text[idx - 1]);
    const after  = idx + key.length >= text.length || !/[a-z]/.test(text[idx + key.length]);
    return before && after;
  };

  // Score a text: collect ALL matching categories, accumulate key-length points.
  // Longer keys score more, so "ground beef" (11) beats "beef" (4) alone.
  // Multiple matches for one category stack — "greek yogurt with blueberries"
  // scores Dairy=18 (greek yogurt=12 + yogurt=6) vs Fruit=9 (blueberry), so Dairy wins.
  const scoreText = (text: string): string | null => {
    const scores: Record<string, number> = {};
    for (const [key, cat] of sorted) {
      if (wordMatch(text, key)) scores[cat] = (scores[cat] ?? 0) + key.length;
    }
    const entries = Object.entries(scores);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
  };

  // Normalise a string through several plural forms.
  const normForms = (text: string): string[] => [
    text.replace(/([a-z]+)ies\b/g, (_, s) => s + 'y'),
    text.replace(/([a-z]+)ves\b/g, (_, s) => s + 'f'),
    text.replace(/([a-z]{3,})es\b/g, (_, s) => s),
    text.replace(/([a-z]{3,})s\b/g,  (_, s) => s),
  ];

  // ── Pass 1: score on original ────────────────────────────────────────────
  const p1 = scoreText(lower);
  if (p1) return p1;

  // ── Pass 2: score on qualifier-stripped ─────────────────────────────────
  if (stripped !== lower) {
    const p2 = scoreText(stripped);
    if (p2) return p2;
  }

  // ── Pass 3: plural normalization on both forms ───────────────────────────
  for (const norm of [...normForms(lower), ...normForms(stripped)]) {
    if (norm !== lower && norm !== stripped) {
      const p3 = scoreText(norm);
      if (p3) return p3;
    }
  }

  // ── Pass 4: structural pattern shortcuts ─────────────────────────────────
  // These catch anything with a clear structural signal not covered by the map.
  if (/\bsyrup\b/.test(lower))                                                        return 'Syrups & Sweeteners';
  if (/\b(powder|supplement)\b/.test(lower) && /\b(protein|collagen|greens|vitamin|whey|creatine|bcaa|probiotic)\b/.test(lower)) return 'Supplements';
  if (/\bfrozen\b/.test(lower))                                                        return 'Frozen Foods';
  if (/\bberr(y|ies)\b/.test(lower))                                                   return 'Fruit';
  if (/\b(nectar|juice)\b/.test(lower) && !/\b(lemon|lime|orange|apple|grape|cran)\b/.test(lower)) return 'Drinks';
  if (/\beggs?\b/.test(lower))                                                           return 'Eggs';
  if (/\bmilk\b/.test(lower))                                                           return 'Dairy';
  if (/\b(coffee|espresso)\b/.test(lower))                                              return 'Coffee & Tea';
  if (/\btea\b/.test(lower))                                                            return 'Coffee & Tea';
  if (/\b(oil)\b/.test(lower))                                                          return 'Condiments & Sauces';
  if (/\bsauce\b/.test(lower))                                                          return 'Condiments & Sauces';
  if (/\bbutter\b/.test(lower))                                                         return 'Condiments & Sauces';
  if (/\b(spread|dressing|vinegar|marinade)\b/.test(lower))                             return 'Condiments & Sauces';
  if (/\bchips?\b/.test(lower))                                                         return 'Snacks & Sweets';
  if (/\bcrackers?\b/.test(lower))                                                      return 'Snacks & Sweets';
  if (/\bbar\b/.test(lower) && !/\bbarley\b/.test(lower))                              return 'Snacks & Sweets';
  if (/\b(supplement|vitamin|probiotic|prebiotic|mineral)\b/.test(lower))               return 'Supplements';
  if (/\b(cake|cookie|brownie|donut|pastry|tart|biscuit)\b/.test(lower))                return 'Snacks & Sweets';
  if (/\b(steak|roast|chop|loin|cutlet|rack|shank|filet)\b/.test(lower))               return 'Meat';
  if (/\b(breast|thigh|wing|drumstick|tender)\b/.test(lower))                          return 'Poultry';
  if (/\b(fillet|fillet|fin|gill)\b/.test(lower))                                       return 'Fish & Seafood';
  if (/\b(flour|dough)\b/.test(lower))                                                  return 'Baking';
  if (/\b(broth|stock|soup)\b/.test(lower))                                             return 'Canned & Jarred';

  return 'Other';
}

function getStorageWarning(name: string, category: Category): string | null {
  const n = name.toLowerCase();
  const preserved = /\b(canned|can\b|jarred|jar\b|dried|dry\b|smoked|cured|pickled|preserved|powdered|dehydrated|freeze.?dried|in water|in oil|in brine|in juice|in syrup)\b/.test(n);

  // ── Pantry warnings (perishables that must be cold) ───────────────────────
  if (category === 'pantry' && !preserved) {
    if (/\b(chicken|turkey|duck|quail|beef|steak|pork|lamb|veal|bison|venison|ribs|brisket|tenderloin|sirloin|ribeye|chuck|flank|burger|meatball|meatloaf|sausage|bacon|bratwurst|chorizo|salami|pepperoni|prosciutto|pancetta|pastrami|bologna|hot dog|deli meat|lunch meat|ground beef|ground pork|ground turkey)\b/.test(n)) {
      return `Raw meat like ${name} spoils rapidly at room temperature and can grow dangerous bacteria within 2 hours. It must be stored in the Fridge (use within 2–3 days) or Freezer.`;
    }
    if (/\b(salmon|tuna|tilapia|cod|halibut|trout|snapper|swordfish|catfish|mahi|bass|flounder|mackerel|herring|sardine|anchovy|pollock|shrimp|prawn|lobster|crab|scallop|oyster|clam|mussel|squid|octopus|crawfish|seafood)\b/.test(n) && !preserved) {
      return `Fresh ${name} is extremely perishable and will spoil within hours at room temperature. It belongs in the Fridge (use within 1–2 days) or Freezer for longer storage.`;
    }
    if (/\b(milk\b|oat milk|almond milk|soy milk|skim milk|whole milk|buttermilk|kefir|yogurt|greek yogurt|sour cream|whipping cream|heavy cream|half and half|cream\b|crème)\b/.test(n)) {
      return `${name} is a perishable dairy item that will sour and become unsafe within hours outside the Fridge. It must stay refrigerated.`;
    }
    if (/\b(butter|ghee)\b/.test(n)) {
      return `${name} will go rancid at room temperature, especially in a warm pantry. Store it in the Fridge to keep it fresh, or the Freezer for long-term storage.`;
    }
    if (/\b(egg\b|eggs\b|large egg|free.range egg)\b/.test(n)) {
      return `${name} need refrigeration once purchased — storing them in the Pantry significantly reduces shelf life and increases the risk of bacterial growth like Salmonella.`;
    }
    if (/\b(cheddar|mozzarella|brie|camembert|gouda|feta|ricotta|cottage cheese|cream cheese|string cheese|parmesan|gruyere|provolone|swiss cheese|american cheese|bocconcini|halloumi)\b/.test(n) || (/\bcheese\b/.test(n) && !/\b(rice cake|cheez|cheeto)\b/.test(n))) {
      return `${name} is a perishable cheese that will spoil and grow mold quickly at room temperature. It needs to stay in the Fridge.`;
    }
    if (/\b(tofu|tempeh|seitan)\b/.test(n)) {
      return `${name} is highly perishable and must be refrigerated. Pantry storage will cause rapid spoilage — it needs to be in the Fridge or Freezer.`;
    }
    if (/\b(lettuce|spinach|arugula|kale|chard|collard|watercress|endive|radicchio|microgreen|spring mix|mixed greens|baby spinach|romaine)\b/.test(n)) {
      return `${name} wilts and deteriorates quickly at room temperature. It needs to stay in the Fridge to remain crisp and safe to eat.`;
    }
    if (/\b(broccoli|cauliflower|brussels sprout|asparagus|mushroom|zucchini|cucumber|celery|leek)\b/.test(n)) {
      return `${name} loses freshness and nutrients quickly outside the Fridge. Store it refrigerated for best quality.`;
    }
    if (/\b(strawberr|blueberr|raspberr|blackberr|cranberr|cherr)\b/.test(n)) {
      return `Fresh ${name} will mold within 1–2 days at room temperature. Refrigerate them immediately to extend shelf life.`;
    }
    if (/\b(avocado)\b/.test(n)) {
      return `Once ripe, ${name} should move to the Fridge to slow browning and spoilage. At room temperature it will over-ripen very quickly.`;
    }
    if (/\b(smoked salmon|lox)\b/.test(n)) {
      return `${name} is cured but still perishable — once opened it must stay refrigerated. The Pantry is not suitable after opening.`;
    }
    if (/\b(miso|tahini)\b/.test(n)) {
      return `${name} should be refrigerated after opening to prevent spoilage and preserve flavor. The Pantry is only suitable for an unopened, sealed container.`;
    }
    if (/\b(fresh herb|fresh basil|fresh cilantro|fresh parsley|fresh dill|fresh mint|fresh thyme|fresh rosemary|fresh chive|fresh tarragon|fresh sage)\b/.test(n)) {
      return `Fresh ${name} wilts and loses potency rapidly at room temperature. Keep it in the Fridge — stand stems in a small glass of water for best results.`;
    }
    if (/\b(hummus)\b/.test(n)) {
      return `${name} must be refrigerated — it contains chickpeas and oil that will spoil quickly at room temperature. Always store it in the Fridge.`;
    }
    if (/\b(guacamole)\b/.test(n)) {
      return `${name} browns and spoils very quickly at room temperature. It needs to stay in the Fridge; press plastic wrap directly onto the surface to slow oxidation.`;
    }
    if (/\b(fresh pasta|fresh gnocchi|fresh ravioli|fresh tortellini|fresh lasagna sheet)\b/.test(n)) {
      return `Fresh ${name} is highly perishable and must be refrigerated. Dry or shelf-stable pasta is fine in the Pantry, but fresh pasta will spoil within hours outside the Fridge.`;
    }
    if (/\b(fresh.?squeezed juice|fresh juice|cold.?pressed juice|raw juice)\b/.test(n)) {
      return `${name} has no preservatives and will ferment and spoil rapidly at room temperature. It must be kept in the Fridge and used within 2–3 days.`;
    }
    if (/\b(mayo|mayonnaise|ranch|caesar dressing|aioli|tartar sauce|remoulade)\b/.test(n)) {
      return `${name} contains eggs and will spoil quickly at room temperature. Once opened it must stay in the Fridge — even commercial varieties.`;
    }
    if (/\b(opened nut butter|natural peanut butter|natural almond butter|natural cashew butter)\b/.test(n)) {
      return `Natural ${name} contains no stabilizers and the oils will go rancid at room temperature. Refrigerate it after opening to keep it fresh.`;
    }
    if (/\b(probiotic|live culture|active culture)\b/.test(n)) {
      return `${name} contains live cultures that will die off and the product will spoil without refrigeration. It must be kept in the Fridge at all times.`;
    }
    if (/\b(kombucha)\b/.test(n) && !/\b(bottled|pasteurized)\b/.test(n)) {
      return `Unpasteurized ${name} is alive and will over-ferment and become unsafe at room temperature. Keep it refrigerated.`;
    }
  }

  // ── Fridge/Pantry warnings (frozen items that must stay frozen) ───────────
  if (category !== 'freezer') {
    if (/\b(ice cream|gelato|sorbet|sherbet|popsicle|ice pop|frozen yogurt)\b/.test(n)) {
      return `${name} must be kept frozen — it will melt and become unsafe in the ${category === 'fridge' ? 'Fridge' : 'Pantry'}. Store it in the Freezer.`;
    }
    if (/\bfrozen\b/.test(n) && /\b(pizza|meal|burrito|waffle|dumpling|dinner|entree|nugget|fries|tater|pot pie|edamame|corn|pea|broccoli|berry|berries|shrimp|chicken|beef|mango|smoothie|açaí|acai)\b/.test(n)) {
      return `${name} is a frozen product and must stay in the Freezer. In the ${category === 'fridge' ? 'Fridge' : 'Pantry'} it will thaw and spoil.`;
    }
  }

  // ── Fridge warnings (items damaged by refrigeration — better in pantry) ───
  if (category === 'fridge') {
    if (/\b(potato\b|potatoes\b|russet|yukon gold|red potato|fingerling)\b/.test(n) && !/\b(sweet potato|mashed|cooked|baked|fried)\b/.test(n)) {
      return `Whole ${name} should not be refrigerated — the cold converts their starches to sugar, causing a gritty texture and dark color when cooked. Store them in a cool, dark Pantry instead.`;
    }
    if (/\b(onion\b|onions\b|yellow onion|red onion|white onion|vidalia)\b/.test(n) && !/\b(green onion|spring onion|scallion|caramelized|cooked|chopped|diced|sliced)\b/.test(n)) {
      return `Whole ${name} shouldn't be refrigerated — the humidity causes rapid mold and softening. Store them in a cool, dry, ventilated Pantry away from potatoes.`;
    }
    if (/\b(garlic\b|head of garlic|garlic bulb|whole garlic)\b/.test(n) && !/\b(minced|chopped|roasted|garlic powder|garlic salt|peeled|clove)\b/.test(n)) {
      return `Whole ${name} heads do best in a cool, dry Pantry with good airflow. Refrigerating them can cause sprouting and mold — only move peeled cloves to the Fridge.`;
    }
    if (/\b(banana\b|bananas\b)\b/.test(n) && !/\b(frozen|overripe|smoothie)\b/.test(n)) {
      return `${name} don't belong in the Fridge — the cold turns their skin black within hours and damages the fruit's texture and sweetness. Store them at room temperature.`;
    }
    if (/\b(whole tomato|tomatoes\b|tomato\b)\b/.test(n) && !/\b(cherry tomato|sun-dried|canned|diced|cooked|paste|sauce|chopped|sliced|cut)\b/.test(n)) {
      return `Whole ${name} lose their flavor and develop a mealy texture in the Fridge. Store uncut tomatoes at room temperature and only refrigerate once cut.`;
    }
    if (/\b(bread\b|sourdough|baguette|loaf|white bread|whole wheat bread|brioche|pita bread)\b/.test(n) && !/\b(crumb|crouton|frozen|dough)\b/.test(n)) {
      return `${name} goes stale up to 3× faster in the Fridge due to starch retrogradation. Keep it in a bread box or bag at room temperature, or slice and freeze for long-term storage.`;
    }
    if (/\b(coffee bean|coffee ground|whole bean|ground coffee|espresso bean)\b/.test(n)) {
      return `${name} absorbs moisture and odors from the Fridge, which dulls the flavor. Store it in an airtight container in the Pantry away from heat and light.`;
    }
    if (/\b(winter squash|butternut squash|acorn squash|spaghetti squash|kabocha|pumpkin\b|whole pumpkin)\b/.test(n) && !/\b(cut|cooked|puree|canned|roasted|peeled)\b/.test(n)) {
      return `Whole ${name} is shelf-stable and keeps for weeks in a cool, dry Pantry. Refrigeration can cause surface damage — only move it to the Fridge once cut or cooked.`;
    }
    if (/\b(watermelon\b|cantaloupe\b|honeydew\b|whole melon)\b/.test(n) && !/\b(cut|sliced|cubed|diced)\b/.test(n)) {
      return `A whole uncut ${name} is best stored at room temperature — cold halts the antioxidant development inside. Move it to the Fridge only after cutting.`;
    }
    if (/\b(mango\b|pineapple\b|papaya\b|peach\b|nectarine\b|plum\b|apricot\b)\b/.test(n) && !/\b(cut|sliced|ripe|overripe|frozen|dried)\b/.test(n)) {
      return `Unripe ${name} should be left at room temperature to ripen fully — cold air stops the ripening process. Once ripe, it can move to the Fridge to extend freshness.`;
    }
    if (/\b(honey\b)\b/.test(n) && !/\b(hot|warm|manuka)\b/.test(n)) {
      return `${name} doesn't need refrigeration and will crystallize and harden in the Fridge, making it hard to use. Store it sealed in the Pantry — it keeps indefinitely at room temperature.`;
    }
    if (/\b(hot sauce|tabasco|sriracha)\b/.test(n)) {
      return `${name} is shelf-stable thanks to its vinegar and salt content — refrigerating it is optional and may thicken it. The Pantry is perfectly fine for long-term storage.`;
    }
  }

  // ── Freezer warnings (items damaged by freezing — shouldn't be frozen) ────
  if (category === 'freezer') {
    if (/\b(olive oil|vegetable oil|coconut oil|avocado oil|sesame oil|canola oil|sunflower oil|grapeseed oil|oil\b)\b/.test(n)) {
      return `${name} doesn't need freezing — most oils will solidify and cloud in the Freezer. Store it in the Pantry at room temperature.`;
    }
    if (!preserved && /\b(rice\b|pasta\b|penne|spaghetti|fettuccine|rigatoni|linguine|flour\b|sugar\b|oat\b|oats\b|cereal\b|quinoa|barley|couscous|cornmeal|breadcrumb|panko|cracker\b|crackers\b|chip\b|chips\b|popcorn)\b/.test(n)) {
      return `${name} is a shelf-stable dry good — the Freezer adds unnecessary moisture and can make it stale or clumpy. The Pantry is the right place for it.`;
    }
    if (/\b(can\b|canned|jarred|broth\b|stock\b|soup\b|tomato sauce|tomato paste|marinara|coconut milk|applesauce)\b/.test(n)) {
      return `${name} is shelf-stable and doesn't need freezing. Freezing canned or jarred goods can cause containers to crack or burst. Store it in the Pantry.`;
    }
    if (/\b(vinegar|soy sauce|fish sauce|worcestershire|hot sauce|sriracha|ketchup|mustard\b|bbq sauce|teriyaki|hoisin|relish|pickle)\b/.test(n)) {
      return `${name} doesn't benefit from freezing — it can separate or change texture. Store it in the Pantry or Fridge after opening.`;
    }
    if (/\b(honey\b|maple syrup|agave|molasses|jam\b|jelly\b|preserves)\b/.test(n)) {
      return `${name} is shelf-stable and doesn't need refrigerating or freezing. It stores perfectly in the Pantry at room temperature.`;
    }
    if (/\b(cumin|paprika|cinnamon|nutmeg|turmeric|oregano|thyme|rosemary|sage|curry|cayenne|chili powder|garlic powder|onion powder|allspice|cardamom|coriander|salt\b|pepper\b|seasoning|spice blend)\b/.test(n) && !preserved) {
      return `${name} is a dry spice — moisture from the Freezer will cause clumping and dull the flavor. Keep it in a cool, dry Pantry instead.`;
    }
    if (/\b(lettuce|spinach|arugula|kale|chard|collard|romaine|spring mix|mixed greens|baby spinach|watercress|endive|radicchio)\b/.test(n) && !preserved) {
      return `${name} is mostly water and will turn into limp, mushy leaves when frozen and thawed. It must be kept in the Fridge — don't freeze it.`;
    }
    if (/\b(cucumber\b|cucumbers\b)\b/.test(n) && !preserved) {
      return `${name} has extremely high water content and will become watery and mushy when frozen. Store it in the Fridge and use within a week.`;
    }
    if (/\b(whole potato|raw potato|russet potato|yukon gold potato|red potato)\b/.test(n) && !/\b(mashed|cooked|baked|fries|fried|tater)\b/.test(n)) {
      return `Raw ${name} should not be frozen — the water inside crystallizes and destroys the cell structure, turning them grainy and inedible when thawed. Store in a cool, dark Pantry.`;
    }
    if (/\b(mayo\b|mayonnaise\b|aioli\b|hollandaise)\b/.test(n)) {
      return `${name} will completely separate and become grainy when frozen — the emulsion breaks and cannot be repaired. Keep it in the Fridge; it doesn't belong in the Freezer.`;
    }
    if (/\b(whole egg\b|egg in shell|raw egg)\b/.test(n)) {
      return `Whole ${name} in their shell should never be frozen — liquid inside expands and cracks the shell, creating a mess and food safety risk. Freeze beaten eggs in a container instead.`;
    }
    if (/\b(soda\b|cola\b|sparkling water|carbonated|fizzy drink|sparkling juice|energy drink)\b/.test(n)) {
      return `${name} will expand when frozen and burst its container — this is dangerous and will make a mess in your Freezer. Store carbonated drinks in the Fridge or Pantry.`;
    }
    if (/\b(brie|camembert|ricotta|cottage cheese|cream cheese|mascarpone|soft cheese)\b/.test(n) || (/\b(ricotta|cottage)\b/.test(n))) {
      return `${name} has a high moisture content that causes it to become grainy and crumbly when frozen. Keep soft cheeses in the Fridge and use within their best-by date.`;
    }
    if (/\b(yogurt\b|greek yogurt|plain yogurt)\b/.test(n) && !/\b(frozen yogurt)\b/.test(n)) {
      return `${name} will separate and become watery and grainy once thawed — the texture is significantly worse after freezing. It belongs in the Fridge, not the Freezer.`;
    }
    if (/\b(cream.based sauce|alfredo|béchamel|white sauce|cream sauce|gravy)\b/.test(n)) {
      return `${name} will separate and curdle when frozen and reheated. Dairy-based sauces are best made fresh or stored in the Fridge for up to 3–4 days.`;
    }
    if (/\b(cooked pasta|cooked rice|cooked noodle)\b/.test(n)) {
      return `${name} tends to become mushy and waterlogged after freezing. It keeps well in the Fridge for 3–5 days — freeze uncooked pasta or rice instead for best results.`;
    }
    if (/\b(raw potato|raw celery|raw cucumber|radish|raw turnip|jicama)\b/.test(n)) {
      return `${name} has high water content and will turn mushy when frozen. These vegetables are best stored in the Fridge and eaten fresh.`;
    }
    if (/\b(gelatin|jello|pudding)\b/.test(n) && !/\b(gelatin powder|unflavored gelatin)\b/.test(n)) {
      return `Set ${name} will weep liquid and lose its texture when frozen. Keep it in the Fridge and consume within a few days.`;
    }
    if (/\b(fried food|fried chicken|fried fish|french fry|french fries|tempura|schnitzel)\b/.test(n) && !/\b(frozen)\b/.test(n)) {
      return `Freshly ${name} will lose its crispy coating and become soggy when frozen and thawed. Store leftovers in the Fridge and reheat in an oven or air fryer within 2 days.`;
    }
    if (/\b(wine\b|beer\b|champagne\b|sparkling wine|prosecco|cava)\b/.test(n)) {
      return `${name} should not be frozen — carbonated varieties will burst, and wine loses its character and structure when frozen. Store in a cool Pantry or wine fridge.`;
    }
    if (/\b(coffee\b|cold brew\b|espresso\b|coffee bean|coffee ground)\b/.test(n)) {
      return `${name} absorbs freezer odors and moisture, which dulls the flavor. Store it in an airtight container in the Pantry — whole beans stay freshest up to a month after opening.`;
    }
  }

  return null;
}

// Always re-derives when stored value is 'Other' or missing
function resolveCategory(item: { foodCategory?: string; baseName?: string; name?: string }): string {
  if (item.foodCategory && item.foodCategory !== 'Other') return item.foodCategory;
  return getFoodCategory(item.baseName || item.name || '');
}

function categoryFromOffTags(tags: string[]): string {
  const t = tags.join(' ').toLowerCase();
  if (/\b(meats?|beef|pork|lamb|veal|deli|charcuterie)\b/.test(t))          return 'Meat';
  if (/\b(poultry|chicken|turkey|duck)\b/.test(t))                          return 'Poultry';
  if (/\b(fish|seafood|salmon|tuna|shrimps?|shellfishes?)\b/.test(t))       return 'Fish & Seafood';
  if (/\b(dairies|dairy|milks?|cheeses?|yogurts?|butters?|creams?)\b/.test(t)) return 'Dairy';
  if (/\beggs?\b/.test(t)) return 'Eggs';
  if (/\b(legumes?|beans?|lentils?|chickpeas?|tofu|tempeh|soy)\b/.test(t)) return 'Legumes & Beans';
  if (/\b(nuts?|seeds?|almonds?|cashews?|peanuts?|walnuts?)\b/.test(t))    return 'Nuts & Seeds';
  if (/\b(vegetables?|greens|salads?)\b/.test(t))                          return 'Vegetables';
  if (/\b(fruits?)\b/.test(t))                                              return 'Fruit';
  if (/\b(breads?|cereals?|pastas?|grains?|noodles?|crackers?|biscuits?)\b/.test(t)) return 'Bread & Grains';
  if (/\b(canned|jarred|preserved|tinned|conserves?)\b/.test(t))            return 'Canned & Jarred';
  if (/\b(baking|pastry|confection)\b/.test(t))                             return 'Baking';
  if (/\b(condiments?|sauces?|dressings?|spreads?|oils?|vinegars?)\b/.test(t)) return 'Condiments & Sauces';
  if (/\b(beverages?|drinks?|juices?|sodas?|waters?|coffees?|teas?|smoothies?)\b/.test(t)) return 'Drinks';
  if (/\b(snacks?|sweets?|candies|chocolates?|cookies?|chips|confectionery)\b/.test(t)) return 'Snacks & Sweets';
  if (/\b(spices?|herbs?|seasonings?)\b/.test(t))                           return 'Herbs & Spices';
  return '';
}

const CATEGORY_ORDER = [
  'Meat', 'Poultry', 'Fish & Seafood', 'Dairy', 'Eggs',
  'Vegetables', 'Fruit', 'Legumes & Beans', 'Nuts & Seeds',
  'Bread & Grains', 'Canned & Jarred', 'Baking',
  'Condiments & Sauces', 'Syrups & Sweeteners', 'Drinks', 'Coffee & Tea',
  'Snacks & Sweets', 'Frozen Foods', 'Prepared & Deli',
  'Supplements', 'Herbs & Spices', 'Leftovers', 'Other',
];

const CATEGORY_ICONS: Record<string, string> = {
  'Meat': '🥩', 'Poultry': '🍗', 'Fish & Seafood': '🐟',
  'Dairy': '🥛', 'Eggs': '🥚', 'Vegetables': '🥦', 'Fruit': '🍎',
  'Legumes & Beans': '🫘', 'Nuts & Seeds': '🥜',
  'Bread & Grains': '🍞', 'Canned & Jarred': '🥫', 'Baking': '🧁',
  'Condiments & Sauces': '🫙', 'Syrups & Sweeteners': '🍯',
  'Drinks': '🧃', 'Coffee & Tea': '☕',
  'Snacks & Sweets': '🍫', 'Frozen Foods': '🥶', 'Prepared & Deli': '🥙',
  'Supplements': '💊', 'Herbs & Spices': '🌿', 'Leftovers': '🍽️', 'Other': '🥘',
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
  protein:     'Most Protein',
  proteinAsc:  'Least Protein',
  cal:         'Most Calories',
  calAsc:      'Least Calories',
  qty:         'Most Quantity',
  qtyAsc:      'Least Quantity',
  recent:      'Recently Added',
  oldest:      'Oldest Added',
  category:    'By Category',
};

const SORT_ICONS: Record<SortBy, string> = {
  expiry: '⏰', expiryAsc: '🌿', alpha: '🔤', alphaDesc: '🔡',
  protein: '💪', proteinAsc: '➖', cal: '🔥', calAsc: '🍃',
  qty: '📦', qtyAsc: '📉', recent: '🕐', oldest: '📅', category: '🗂️',
};

const NUTRITION_FILTERS = [
  { key: 'highProtein', label: 'High Protein', desc: '≥ 15g', emoji: '💪' },
  { key: 'lowCal',      label: 'Low Cal',      desc: '< 150', emoji: '🍃' },
  { key: 'lowCarb',     label: 'Low Carb',     desc: '< 15g', emoji: '🥑' },
  { key: 'highFat',     label: 'High Fat',     desc: '≥ 10g', emoji: '🧈' },
] as const;

const emptyForm = () => ({
  name: '', qty: '1', unit: '', expiryDate: '', category: 'fridge' as Category,
  protein: '', carbs: '', fat: '', cal: '', foodCategory: '', icon: '', servingSize: '',
});

const SCREEN_H      = Dimensions.get('window').height;
const SUPABASE_URL  = process.env.EXPO_PUBLIC_SUPABASE_URL  ?? '';
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

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
        Animated.timing(overlay, { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.spring(sheet,   { toValue: 0, damping: 36, stiffness: 130, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      kbOffset.setValue(0);
      Animated.parallel([
        Animated.timing(overlay, { toValue: 0, duration: 260, useNativeDriver: true }),
        Animated.timing(sheet,   { toValue: 600, duration: 280, useNativeDriver: true }),
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
      <View style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: overlay }]} pointerEvents="none" />
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
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
    <View style={[StyleSheet.absoluteFill, { zIndex: 999, elevation: 999 }]} pointerEvents="none">
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

// ─── Scan Status Strip (receipt + label scans) ───────────────────────────────
function ScanStatusStrip({ visible, label, sublabel }: { visible: boolean; label: string; sublabel: string }) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(120)).current;
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;
  const dotLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, { toValue: 0, damping: 22, stiffness: 260, useNativeDriver: true }).start();
      dotLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(dot1, { toValue: 1,   duration: 220, useNativeDriver: true }),
          Animated.timing(dot1, { toValue: 0.3, duration: 220, useNativeDriver: true }),
          Animated.timing(dot2, { toValue: 1,   duration: 220, useNativeDriver: true }),
          Animated.timing(dot2, { toValue: 0.3, duration: 220, useNativeDriver: true }),
          Animated.timing(dot3, { toValue: 1,   duration: 220, useNativeDriver: true }),
          Animated.timing(dot3, { toValue: 0.3, duration: 220, useNativeDriver: true }),
        ])
      );
      dotLoopRef.current.start();
    } else {
      dotLoopRef.current?.stop();
      dot1.setValue(0.3); dot2.setValue(0.3); dot3.setValue(0.3);
      Animated.timing(translateY, { toValue: 120, duration: 200, useNativeDriver: true }).start();
    }
    return () => dotLoopRef.current?.stop();
  }, [visible]);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        paddingBottom: Math.max(insets.bottom, 20) + 10,
        paddingTop: 18, paddingHorizontal: 24,
        backgroundColor: '#0A5740',
        flexDirection: 'row', alignItems: 'center', gap: 16,
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.2, shadowRadius: 10, elevation: 10,
        transform: [{ translateY }],
        zIndex: 200,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
        {([dot1, dot2, dot3] as Animated.Value[]).map((dot, i) => (
          <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#5DCAA5', opacity: dot }} />
        ))}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600', fontFamily: 'Fraunces_400Regular' }}>{label}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 }}>{sublabel}</Text>
      </View>
    </Animated.View>
  );
}

// ─── Barcode Scan Strip ────────────────────────────────────────────────────────
function BarcodeScanStrip({ visible, scanSuccess, scannedEmoji, scannedName }: {
  visible: boolean;
  scanSuccess: boolean | null;
  scannedEmoji: string;
  scannedName: string;
}) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(120)).current;
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;
  const dotLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (visible) {
      dot1.setValue(0.3); dot2.setValue(0.3); dot3.setValue(0.3);
      Animated.spring(translateY, { toValue: 0, damping: 22, stiffness: 260, useNativeDriver: true }).start();
      dotLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(dot1, { toValue: 1,   duration: 220, useNativeDriver: true }),
          Animated.timing(dot1, { toValue: 0.3, duration: 220, useNativeDriver: true }),
          Animated.timing(dot2, { toValue: 1,   duration: 220, useNativeDriver: true }),
          Animated.timing(dot2, { toValue: 0.3, duration: 220, useNativeDriver: true }),
          Animated.timing(dot3, { toValue: 1,   duration: 220, useNativeDriver: true }),
          Animated.timing(dot3, { toValue: 0.3, duration: 220, useNativeDriver: true }),
        ])
      );
      dotLoopRef.current.start();
    } else {
      dotLoopRef.current?.stop();
      dot1.setValue(0.3); dot2.setValue(0.3); dot3.setValue(0.3);
      Animated.timing(translateY, { toValue: 120, duration: 200, useNativeDriver: true }).start();
    }
    return () => dotLoopRef.current?.stop();
  }, [visible]);

  useEffect(() => {
    if (scanSuccess !== null) {
      dotLoopRef.current?.stop();
      dot1.setValue(0.3); dot2.setValue(0.3); dot3.setValue(0.3);
    }
  }, [scanSuccess]);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        paddingBottom: Math.max(insets.bottom, 20) + 10,
        paddingTop: 18, paddingHorizontal: 24,
        backgroundColor: '#0A5740',
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.2, shadowRadius: 10, elevation: 10,
        transform: [{ translateY }],
        zIndex: 1001,
      }}
    >
      {scanSuccess === null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
            {([dot1, dot2, dot3] as Animated.Value[]).map((dot, i) => (
              <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#5DCAA5', opacity: dot }} />
            ))}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600', fontFamily: 'Fraunces_400Regular' }}>looking up product</Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 }}>Searching Open Food Facts…</Text>
          </View>
        </View>
      ) : scanSuccess === true ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Text style={{ fontSize: 26 }}>{scannedEmoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#5DCAA5', fontSize: 13, fontWeight: '700' }}>found it ✓</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '500', marginTop: 1 }} numberOfLines={1}>{scannedName}</Text>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Text style={{ fontSize: 20, color: '#E8756A' }}>✕</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#E8756A', fontSize: 14, fontWeight: '600' }}>not in database</Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 1 }}>try adding nutrition manually</Text>
          </View>
        </View>
      )}
    </Animated.View>
  );
}

function makeSeedItems(): Item[] {
  const s = (icon: string, name: string, qty: string, unit: string, cat: Category, daysOffset: number, protein: number, carbs: number, fat: number, cal: number): Item => {
    const today = new Date(); today.setHours(0,0,0,0);
    const exp = new Date(today); exp.setDate(today.getDate() + daysOffset);
    const expiryDate = exp.toISOString().slice(0,10);
    const days = daysOffset;
    return {
      id: Date.now() + Math.floor(Math.random() * 1e9),
      icon, name, baseName: name,
      batch: 1, qty, unit,
      expiryDate, expires: getExpiryText(days),
      badge: getBadge(days, cat), days,
      protein, carbs, fat, cal,
      qtyNum: parseFloat(qty) || 1,
      category: cat,
      addedAt: Date.now(),
      foodCategory: getFoodCategory(name),
    };
  };
  return [
    // ── Fridge — Meat ─────────────────────────────────────────────────────────
    s('🥩', 'Ground Beef 80/20',         '1',   'lb',     'fridge',  1, 17,  0, 20, 254),
    s('🥩', 'Chicken Breast',            '2',   'lbs',    'fridge',  2, 31,  0,  3, 165),
    s('🥓', 'Applewood Smoked Bacon',    '12',  'oz',     'fridge',  7, 10,  0, 22, 240),
    s('🥩', 'Pork Tenderloin',           '1',   'lb',     'fridge',  3, 26,  0,  4, 143),
    s('🥓', 'Deli Turkey Slices',        '9',   'oz',     'fridge',  5, 18,  2,  2, 100),
    // ── Fridge — Fish & Seafood ───────────────────────────────────────────────
    s('🐟', 'Atlantic Salmon Fillet',    '6',   'oz',     'fridge',  3, 34,  0, 12, 233),
    s('🐟', 'Cod Fillet',                '8',   'oz',     'fridge',  2, 20,  0,  1,  90),
    s('🍳', 'Smoked Salmon',             '4',   'oz',     'fridge',  0, 22,  0,  6, 132),
    // ── Fridge — Dairy / Eggs ─────────────────────────────────────────────────
    s('🥛', 'Whole Milk 2%',             '1',   'gallon', 'fridge',  6,  8, 12,  5, 120),
    s('🥚', 'Large Eggs',                '12',  'ct',     'fridge', 18,  6,  1,  5,  70),
    s('🧀', 'Sharp Cheddar Block',       '8',   'oz',     'fridge', 14, 25,  0, 34, 420),
    s('🧀', 'Parmesan Wedge',            '4',   'oz',     'fridge', 21, 10,  1, 29, 420),
    s('🧀', 'Feta Cheese',               '6',   'oz',     'fridge', 10,  4,  1, 12, 140),
    s('🧀', 'Cream Cheese',              '8',   'oz',     'fridge', 12,  2,  4, 10, 100),
    s('🥛', 'Greek Yogurt Plain',        '32',  'oz',     'fridge',  9, 17,  9,  0, 100),
    s('🫙', 'Cottage Cheese',            '16',  'oz',     'fridge',  6, 14,  4,  2,  90),
    s('🥛', 'Sour Cream',                '16',  'oz',     'fridge',  8,  1,  4, 20, 200),
    s('🥛', 'Heavy Whipping Cream',      '16',  'oz',     'fridge', 14,  0,  3, 44, 414),
    s('🧈', 'Unsalted Butter',           '1',   'lb',     'fridge', 30,  0,  0, 11, 102),
    // ── Fridge — Vegetables ───────────────────────────────────────────────────
    s('🥦', 'Broccoli Florets',          '12',  'oz',     'fridge',  5,  2,  6,  0,  31),
    s('🥕', 'Baby Carrots',              '16',  'oz',     'fridge', 12,  1,  7,  0,  35),
    s('🫑', 'Bell Peppers Mix',           '3',   'ct',     'fridge',  8,  1,  6,  0,  31),
    s('🥬', 'Baby Spinach',              '5',   'oz',     'fridge',  4,  3,  3,  0,  23),
    s('🥬', 'Kale Bunch',                '1',   'bunch',  'fridge',  6,  3,  9,  1,  49),
    s('🍅', 'Cherry Tomatoes',           '10',  'oz',     'fridge',  7,  1,  4,  0,  27),
    s('🍄', 'Baby Bella Mushrooms',      '8',   'oz',     'fridge',  5,  2,  3,  0,  20),
    s('🥒', 'Persian Cucumbers',         '6',   'ct',     'fridge',  8,  1,  3,  0,  16),
    s('🌿', 'Celery Stalks',             '1',   'bunch',  'fridge', 10,  1,  3,  0,  14),
    s('🧅', 'Green Onions',              '1',   'bunch',  'fridge',  7,  1,  3,  0,  16),
    s('🌿', 'Fresh Ginger Root',         '4',   'oz',     'fridge', 30,  0,  9,  0,  40),
    s('🧄', 'Garlic Bulb',               '1',   'head',   'fridge', 21,  0,  4,  0,  18),
    // ── Fridge — Fruit ────────────────────────────────────────────────────────
    s('🥑', 'Hass Avocados',             '2',   'ct',     'fridge',  3,  2,  9, 15, 160),
    s('🍓', 'Strawberries',              '1',   'lb',     'fridge',  5,  1, 11,  0,  49),
    s('🫐', 'Blueberries',               '6',   'oz',     'fridge',  7,  1, 14,  0,  57),
    s('🍇', 'Red Seedless Grapes',       '2',   'lbs',    'fridge', 10,  1, 27,  0, 104),
    s('🍑', 'Peaches',                   '4',   'ct',     'fridge',  4,  1, 14,  0,  59),
    s('🍋', 'Lemons',                    '5',   'ct',     'fridge', 14,  0,  7,  0,  29),
    s('🍋', 'Limes',                     '6',   'ct',     'fridge', 14,  0,  7,  0,  20),
    s('🍊', 'Grapefruit',                '2',   'ct',     'fridge', 21,  1, 11,  0,  42),
    // ── Fridge — Condiments & Sauces ─────────────────────────────────────────
    s('🫙', 'Hummus Classic',            '10',  'oz',     'fridge',  7,  5,  8,  9, 140),
    s('🥑', 'Guacamole',                 '8',   'oz',     'fridge',  3,  1,  6, 11, 110),
    s('🫙', 'Ranch Dressing',            '16',  'oz',     'fridge', 30,  1,  2, 14, 140),
    s('🫙', 'Salsa Roja',                '16',  'oz',     'fridge', 21,  1,  4,  0,  20),
    s('🫙', 'Dijon Mustard',             '8',   'oz',     'fridge', 90,  1,  1,  1,  15),
    s('🫙', 'Miso Paste',                '14',  'oz',     'fridge', 45,  3, 10,  1,  56),
    s('🥫', 'Mayonnaise',                '30',  'oz',     'fridge', 90,  0,  0, 10,  90),
    // ── Fridge — Bread & Grains ───────────────────────────────────────────────
    s('🥞', 'Flour Tortillas',           '10',  'ct',     'fridge', 12,  3, 27,  3, 140),
    // ── Fridge — Drinks ───────────────────────────────────────────────────────
    s('🧃', 'Orange Juice',              '52',  'oz',     'fridge',  8,  2, 26,  0, 110),
    s('☕', 'Cold Brew Coffee',           '32',  'oz',     'fridge',  7,  0,  0,  0,   5),
    s('🥛', 'Oat Milk',                  '32',  'oz',     'fridge', 10,  1,  9,  3,  60),
    s('🧃', 'Green Juice',               '16',  'oz',     'fridge',  2,  2, 18,  0,  80),
    // ── Fridge — Herbs & Spices ───────────────────────────────────────────────
    s('🌿', 'Fresh Basil',               '1',   'bunch',  'fridge', -1,  1,  1,  0,   8),
    s('🌿', 'Cilantro',                  '1',   'bunch',  'fridge',  2,  1,  1,  0,   8),
    s('🌿', 'Flat-Leaf Parsley',         '1',   'bunch',  'fridge',  5,  1,  2,  0,  11),
    s('🌿', 'Fresh Dill',                '1',   'bunch',  'fridge',  4,  1,  2,  0,  11),

    // ── Freezer — Meat ────────────────────────────────────────────────────────
    s('🥩', 'Ribeye Steaks',             '2',   'ct',     'freezer', 60, 28,  0, 34, 410),
    s('🥩', 'Ground Turkey',             '2',   'lbs',    'freezer', 90, 22,  0,  8, 170),
    s('🌭', 'Italian Sausage Links',     '5',   'ct',     'freezer', 60, 14,  2, 22, 260),
    s('🥩', 'Turkey Meatballs',          '32',  'oz',     'freezer', 90, 14,  9, 10, 180),
    // ── Freezer — Poultry ─────────────────────────────────────────────────────
    s('🍗', 'Frozen Chicken Thighs',     '4',   'lbs',    'freezer', 90, 27,  0, 13, 209),
    s('🍗', 'Chicken Nuggets',           '32',  'oz',     'freezer', 45, 12, 17,  9, 200),
    // ── Freezer — Fish & Seafood ──────────────────────────────────────────────
    s('🍤', 'Frozen Shrimp Large',       '2',   'lbs',    'freezer', 75, 20,  0,  2,  99),
    s('🐟', 'Tilapia Fillets',           '4',   'ct',     'freezer', 120, 23, 0,  2, 110),
    s('🐟', 'Wild Caught Cod Portions',  '4',   'ct',     'freezer', 90, 19,  0,  1,  82),
    s('🐟', 'King Salmon Portions',      '4',   'ct',     'freezer', 120, 25, 0, 12, 208),
    // ── Freezer — Vegetables ──────────────────────────────────────────────────
    s('🌽', 'Frozen Sweet Corn',         '12',  'oz',     'freezer', 180,  3, 19,  1,  90),
    s('🥦', 'Frozen Broccoli',           '12',  'oz',     'freezer', 200,  3,  7,  0,  35),
    s('🫛', 'Frozen Edamame',            '16',  'oz',     'freezer', 150, 11,  9,  5, 122),
    s('🥕', 'Frozen Mixed Vegetables',   '16',  'oz',     'freezer', 240,  2, 11,  0,  50),
    s('🥬', 'Frozen Chopped Spinach',    '10',  'oz',     'freezer', 180,  3,  3,  0,  23),
    s('🫛', 'Frozen Green Peas',         '16',  'oz',     'freezer', 180,  5, 14,  0,  81),
    // ── Freezer — Fruit ───────────────────────────────────────────────────────
    s('🫐', 'Frozen Mixed Berries',      '16',  'oz',     'freezer',  90,  1, 15,  0,  60),
    s('🥭', 'Frozen Mango Chunks',       '16',  'oz',     'freezer', 90,   1, 25,  0, 100),
    s('🍌', 'Frozen Bananas',            '4',   'ct',     'freezer', 90,   1, 27,  0, 105),
    // ── Freezer — Snacks & Sweets ─────────────────────────────────────────────
    s('🥣', 'Açaí Packs',               '4',   'ct',     'freezer',  90,  2, 18,  7, 150),
    s('🍦', 'Vanilla Ice Cream',         '1.5', 'qt',     'freezer',  60,  4, 28, 11, 210),
    s('🍭', 'Frozen Fruit Bars',         '6',   'ct',     'freezer',  90,  0, 16,  0,  60),
    // ── Freezer — Bread & Grains ──────────────────────────────────────────────
    s('🧇', 'Frozen Waffles',            '10',  'ct',     'freezer',  90,  3, 25,  4, 150),
    s('🍞', 'Sourdough Dinner Rolls',    '6',   'ct',     'freezer', 120,  4, 26,  1, 130),
    // ── Freezer — Meals (pre-packaged) ───────────────────────────────────────
    s('🍕', 'Frozen Margherita Pizza',   '1',   'ct',     'freezer',  45, 12, 46, 16, 370),
    s('🥟', 'Pork Dumplings',            '24',  'ct',     'freezer', 120,  9, 23,  8, 200),
    s('🌯', 'Frozen Breakfast Burritos', '4',   'ct',     'freezer',  90, 16, 36, 12, 310),
    s('🥧', 'Frozen Chicken Pot Pie',    '1',   'ct',     'freezer',  60, 12, 38, 22, 390),

    // ── Pantry — Bread & Grains ───────────────────────────────────────────────
    s('🍚', 'Jasmine Rice',              '5',   'lbs',    'pantry', 365,  4, 44,  0, 200),
    s('🍚', 'Brown Rice',                '2',   'lbs',    'pantry', 365,  3, 45,  1, 216),
    s('🍝', 'Penne Pasta',               '16',  'oz',     'pantry', 540,  7, 43,  1, 200),
    s('🍝', 'Spaghetti',                 '16',  'oz',     'pantry', 540,  7, 43,  1, 200),
    s('🌾', 'Rolled Oats',               '42',  'oz',     'pantry', 365,  5, 27,  3, 150),
    s('🍚', 'Quinoa',                    '16',  'oz',     'pantry', 365,  8, 39,  4, 222),
    s('🌾', 'Farro',                     '16',  'oz',     'pantry', 365,  6, 39,  1, 200),
    s('🌾', 'All-Purpose Flour',         '5',   'lbs',    'pantry', 365,  3, 23,  0, 100),
    s('🌾', 'Bread Flour',               '5',   'lbs',    'pantry', 365,  4, 22,  1, 100),
    s('🥣', 'Granola',                   '12',  'oz',     'pantry', 180,  4, 32,  7, 200),
    s('🥣', 'Corn Flakes Cereal',        '18',  'oz',     'pantry', 270,  2, 24,  0, 100),
    s('🍞', 'Sourdough Bread',           '1',   'loaf',   'pantry',  4,   4, 24,  1, 120),
    s('🫓', 'Corn Tortillas',            '30',  'ct',     'pantry', 30,   1, 11,  1,  50),
    s('🍚', 'Panko Breadcrumbs',         '8',   'oz',     'pantry', 365,  4, 22,  1, 110),
    s('🍜', 'Ramen Noodles',             '4',   'ct',     'pantry', 365,  4, 52,  7, 380),
    // ── Pantry — Canned & Jarred ──────────────────────────────────────────────
    s('🫘', 'Black Beans Can',           '15',  'oz',     'pantry', 730,  7, 20,  0, 110),
    s('🫘', 'Chickpeas Can',             '15',  'oz',     'pantry', 730,  7, 27,  2, 170),
    s('🫘', 'Kidney Beans Can',          '15',  'oz',     'pantry', 730,  8, 20,  0, 110),
    s('🫘', 'Red Lentils',               '16',  'oz',     'pantry', 365,  9, 20,  0, 116),
    s('🍅', 'Crushed Tomatoes Can',      '28',  'oz',     'pantry', 540,  2,  6,  0,  35),
    s('🍅', 'Diced Tomatoes Can',        '14.5','oz',     'pantry', 540,  1,  5,  0,  25),
    s('🍅', 'Tomato Paste',              '6',   'oz',     'pantry', 365,  2, 10,  0,  50),
    s('🐟', 'Tuna Can in Water',         '5',   'oz',     'pantry', 365, 22,  0,  1, 100),
    s('🐟', 'Canned Salmon',             '14.5','oz',     'pantry', 365, 25,  0,  7, 170),
    s('🥫', 'Coconut Milk Can',          '13.5','oz',     'pantry', 365,  1,  2, 14, 138),
    s('🫙', 'Chicken Broth',             '32',  'oz',     'pantry', 180,  1,  1,  0,  10),
    s('🫙', 'Vegetable Broth',           '32',  'oz',     'pantry', 365,  0,  2,  0,  10),
    s('🫒', 'Kalamata Olives Jar',       '6',   'oz',     'pantry', 365,  0,  2, 10,  90),
    s('🫙', 'Roasted Red Peppers Jar',   '12',  'oz',     'pantry', 365,  1,  4,  0,  25),
    s('🥫', 'Artichoke Hearts Can',      '14',  'oz',     'pantry', 540,  4, 10,  0,  60),
    s('🎃', 'Canned Pumpkin',            '15',  'oz',     'pantry', 730,  1,  7,  0,  35),
    // ── Pantry — Legumes & Beans (dry) ────────────────────────────────────────
    s('🫘', 'Dry Pinto Beans',           '16',  'oz',     'pantry', 730,  8, 22,  0, 122),
    s('🫘', 'Green Lentils',             '16',  'oz',     'pantry', 730,  9, 20,  0, 116),
    // ── Pantry — Nuts & Seeds ─────────────────────────────────────────────────
    s('🌰', 'Raw Almonds',               '16',  'oz',     'pantry', 365,  6,  6, 14, 164),
    s('🥜', 'Walnut Halves',             '12',  'oz',     'pantry', 180,  4,  4, 18, 185),
    s('🥜', 'Roasted Cashews',           '8',   'oz',     'pantry', 180,  5,  9, 12, 157),
    s('🥜', 'Natural Peanut Butter',     '16',  'oz',     'pantry', 180,  8,  7, 16, 190),
    s('🥜', 'Sunflower Seeds',           '8',   'oz',     'pantry', 365,  6,  5, 14, 164),
    s('🫙', 'Chia Seeds',                '12',  'oz',     'pantry', 365,  5, 12, 10, 138),
    s('🫙', 'Tahini',                    '16',  'oz',     'pantry', 180,  5,  5, 15, 178),
    // ── Pantry — Condiments & Sauces ─────────────────────────────────────────
    s('🫒', 'Extra Virgin Olive Oil',    '16.9','oz',     'pantry', 365,  0,  0, 14, 120),
    s('🫙', 'Soy Sauce',                 '10',  'oz',     'pantry', 365,  1,  1,  0,  10),
    s('🌶️','Sriracha Hot Sauce',        '17',  'oz',     'pantry', 365,  0,  1,  0,   5),
    s('🍎', 'Apple Cider Vinegar',       '16',  'oz',     'pantry', 365,  0,  0,  0,   3),
    s('🫙', 'Balsamic Vinegar',          '16',  'oz',     'pantry', 365,  0,  3,  0,  14),
    s('🫙', 'Fish Sauce',                '6.76','oz',     'pantry', 365,  1,  1,  0,  10),
    s('🫙', 'Worcestershire Sauce',      '10',  'oz',     'pantry', 365,  0,  1,  0,   5),
    s('🫙', 'Ketchup',                   '20',  'oz',     'pantry', 365,  0,  5,  0,  20),
    s('🍯', 'Maple Syrup',               '12',  'oz',     'pantry', 730,  0, 13,  0,  52),
    s('🍯', 'Raw Honey',                 '12',  'oz',     'pantry', 1825, 0, 17,  0,  60),
    s('🫙', 'Teriyaki Sauce',            '12',  'oz',     'pantry', 365,  1,  8,  0,  40),
    s('🫙', 'BBQ Sauce',                 '18',  'oz',     'pantry', 365,  0, 12,  0,  50),
    s('🌶️','Tabasco Hot Sauce',         '5',   'oz',     'pantry', 730,  0,  0,  0,   0),
    // ── Pantry — Baking ───────────────────────────────────────────────────────
    s('🍬', 'Granulated Sugar',          '4',   'lbs',    'pantry', 1825, 0, 25,  0, 100),
    s('🍬', 'Dark Brown Sugar',          '2',   'lbs',    'pantry', 1825, 0, 27,  0, 106),
    s('🌾', 'Cornstarch',                '16',  'oz',     'pantry', 1825, 0, 30,  0, 120),
    s('🫙', 'Baking Powder',             '8.1', 'oz',     'pantry', 730,  0,  1,  0,   2),
    s('🫙', 'Baking Soda',               '16',  'oz',     'pantry', 1825, 0,  0,  0,   0),
    s('🫙', 'Vanilla Extract',           '4',   'oz',     'pantry', 1825, 0,  1,  0,  12),
    s('🍫', 'Cocoa Powder',              '8',   'oz',     'pantry', 365,  2,  3,  1,  20),
    s('🍫', 'Chocolate Chips',           '12',  'oz',     'pantry', 365,  2, 18,  9, 140),
    s('🍫', 'Dark Chocolate 70%',        '3.5', 'oz',     'pantry',  90,  3, 20, 18, 250),
    s('🫙', 'Active Dry Yeast',          '4',   'oz',     'pantry', 180,  8,  7,  1,  60),
    // ── Pantry — Herbs & Spices ───────────────────────────────────────────────
    s('🧂', 'Kosher Salt',               '26',  'oz',     'pantry', 1825, 0,  0,  0,   0),
    s('🌿', 'Black Pepper Grinder',      '2',   'oz',     'pantry', 365,  0,  1,  0,   6),
    s('🌿', 'Ground Cumin',              '2',   'oz',     'pantry', 365,  0,  1,  0,   8),
    s('🌿', 'Smoked Paprika',            '2',   'oz',     'pantry', 365,  0,  2,  0,  10),
    s('🌿', 'Ground Cinnamon',           '2',   'oz',     'pantry', 365,  0,  2,  0,   8),
    s('🌿', 'Ground Turmeric',           '2',   'oz',     'pantry', 365,  0,  2,  0,   8),
    s('🌿', 'Garlic Powder',             '3',   'oz',     'pantry', 365,  1,  3,  0,  16),
    s('🌿', 'Onion Powder',              '2.5', 'oz',     'pantry', 365,  0,  3,  0,  14),
    s('🌿', 'Italian Seasoning',         '2',   'oz',     'pantry', 365,  0,  2,  0,  10),
    s('🌶️','Cayenne Pepper',            '2',   'oz',     'pantry', 365,  0,  1,  0,   6),
    s('🌶️','Red Pepper Flakes',         '2',   'oz',     'pantry', 365,  0,  1,  0,   6),
    s('🌿', 'Dried Oregano',             '0.75','oz',     'pantry', 365,  0,  2,  0,   8),
    s('🌿', 'Dried Thyme',               '0.75','oz',     'pantry', 365,  0,  2,  0,   8),
    s('🌿', 'Bay Leaves',                '0.5', 'oz',     'pantry', 730,  0,  1,  0,   4),
    s('🌿', 'Curry Powder',              '2',   'oz',     'pantry', 365,  0,  2,  0,  10),
    // ── Pantry — Snacks & Sweets ──────────────────────────────────────────────
    s('🌽', 'Popcorn Kernels',           '32',  'oz',     'pantry', 365,  3, 28,  4, 140),
    s('🥜', 'Granola Bars',              '6',   'ct',     'pantry',  30,  3, 29,  7, 190),
    s('💪', 'Protein Bars',              '12',  'ct',     'pantry',  60, 20, 22,  8, 210),
    s('🍘', 'Rice Cakes',                '4.5', 'oz',     'pantry', 90,   1, 14,  0,  60),
    s('🌮', 'Tortilla Chips',            '10',  'oz',     'pantry',  30,  2, 20,  7, 140),
    s('🥜', 'Trail Mix',                 '16',  'oz',     'pantry',  30,  5, 21, 12, 200),
    s('🥨', 'Pretzels',                  '16',  'oz',     'pantry',  60,  3, 22,  1, 110),
    // ── Pantry — Drinks ───────────────────────────────────────────────────────
    s('☕', 'Ground Coffee',              '12',  'oz',     'pantry', 180,  0,  0,  0,   0),
    s('🍵', 'Green Tea Bags',             '20',  'ct',     'pantry', 365,  0,  0,  0,   0),
    s('🍵', 'Chamomile Tea Bags',         '20',  'ct',     'pantry', 365,  0,  0,  0,   0),
    s('🧃', 'Sparkling Water Cases',      '12',  'ct',     'pantry', 365,  0,  0,  0,   0),
  ].map((item, i) => ({ ...item, id: i + 1 }));
}

export default function FridgeScreen() {
  const router = useRouter();
  const { colors, isDark, toggleTheme, listDensity } = useTheme();
  const insets = useSafeAreaInsets();
  const badgeSoft = isDark ? BADGE_SOFT_DARK : BADGE_SOFT_LIGHT;
  const iconBg: Record<Badge, string> = isDark
    ? { red: 'rgba(245,90,90,0.2)', amber: 'rgba(245,180,60,0.2)', green: 'rgba(93,202,165,0.2)', blue: 'rgba(100,160,255,0.2)', black: '#2C2C2E' }
    : { red: '#FCEBEB', amber: '#FFF8E6', green: '#E1F5EE', blue: '#E6F1FB', black: '#2C2C2E' };
  const { signOut, user } = useAuth();
  const { menuBtn, drawerEl } = useAppDrawer();
  const { isPremium, isAnnual, isHouseholdJoiner, showPaywall } = useSubscription();
  const styles = useMemo(() => createStyles(colors, listDensity === 'compact', isDark), [colors, listDensity, isDark]);
  const [items, setItems]               = useState<Item[]>([]);
  const [expanded, setExpanded]         = useState<number | null>(null);
  const [activeTab, setActiveTab]       = useState<TabView>('all');
  const [openedSections, setOpenedSections] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd]           = useState(false);
  const [editItem, setEditItem]         = useState<Item | null>(null);
  const [form, setForm]                 = useState(emptyForm());
  const [nextId, setNextId]             = useState(100);
  const [sortBy, setSortBy]             = useState<SortBy>('category');
  const [scanning, setScanning]         = useState(false);
  const [searchQuery, setSearchQuery]   = useState('');
  const [showSortFilter, setShowSortFilter]         = useState(false);
  const [showExpiringDetail, setShowExpiringDetail] = useState(false);
  const [filterFoodCats, setFilterFoodCats]         = useState<string[]>([]);
  const [filterExpiry, setFilterExpiry]             = useState<string[]>([]);
  const [filterNutrition, setFilterNutrition]       = useState<string[]>([]);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [barcodeScanned, setBarcodeScanned]         = useState(false);
  const [scanningReceipt, setScanningReceipt]       = useState(false);
  const [scanningLabel,   setScanningLabel]         = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [showSuccess, setShowSuccess]               = useState(false);
  const [showSaveConfirm, setShowSaveConfirm]       = useState(false);
  const [lastSaved, setLastSaved]                   = useState<Item | null>(null);
  const [itemHistory, setItemHistory]               = useState<HistoryItem[]>([]);
  const [barcodeProcessing, setBarcodeProcessing]   = useState(false);
  const [useModalItem, setUseModalItem]             = useState<Item | null>(null);
  const [useAmount, setUseAmount]                   = useState('');
  const [scannedName, setScannedName]               = useState('');
  const [scannedEmoji, setScannedEmoji]             = useState('🔍');
  const [scanSuccess, setScanSuccess]               = useState<boolean | null>(null);

  const listFade    = useRef(new Animated.Value(1)).current;
  const listSlide   = useRef(new Animated.Value(0)).current;
  const addBtnScale = useRef(new Animated.Value(1)).current;
  const scanPulse   = useRef(new Animated.Value(1)).current;
  const beamAnim    = useRef(new Animated.Value(0)).current;
  const successAnim = useRef(new Animated.Value(0)).current;
  const removeAnims = useRef<Map<number, { x: Animated.Value; op: Animated.Value }>>(new Map());
  const screenFade     = useRef(new Animated.Value(0)).current;
  const screenSlide    = useRef(new Animated.Value(24)).current;
  const heroScale      = useRef(new Animated.Value(0.94)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentSlide   = useRef(new Animated.Value(15)).current;
  const barcodeLockRef = useRef(false);
  const [blastVisible, setBlastVisible] = useState(false);
  const [badVisible,   setBadVisible]   = useState(false);
  const [toastMsg, setToastMsg]         = useState('');
  const [toastBad, setToastBad]         = useState(false);
  const toastAnim = useRef(new Animated.Value(0)).current;

  const [stats, setStats] = useState({ goneGood: 0, goneBad: 0, totalAdded: 0 });
  const [householdId,   setHouseholdId]   = useState<string | null>(null);
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const loadedHouseholdIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const loadItems = async () => {
      // 1. Load from AsyncStorage immediately (fast, offline-safe)
      const raw = await AsyncStorage.getItem('gogood_items');
      // Seed demo data once (version flag prevents re-seeding after user clears items)
      const seeded = await AsyncStorage.getItem('gogood_seed_v3');
      const val = !seeded
        ? (() => {
            const existing = raw ? JSON.parse(raw) : [];
            const seed = makeSeedItems();
            const merged = [...existing, ...seed];
            AsyncStorage.setItem('gogood_items', JSON.stringify(merged));
            AsyncStorage.setItem('gogood_seed_v3', '1');
            return JSON.stringify(merged);
          })()
        : raw;
      let localItems: any[] = [];
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
        localItems = migrated.map((i: any, idx: number) => {
          if (seen.has(i.id)) return { ...i, id: 1000 + idx };
          seen.add(i.id);
          return i;
        });
        setItems(localItems);
        const maxId = Math.max(...localItems.map((i: any) => i.id), 99);
        setNextId(maxId + 1);
      }

      // 2. Pull from Supabase and merge (remote wins for newer items)
      if (user?.id) {
        const [hhId, hhName] = await Promise.all([
          AsyncStorage.getItem(HOUSEHOLD_KEY),
          AsyncStorage.getItem(HOUSEHOLD_NAME_KEY),
        ]);
        setHouseholdId(hhId);
        setHouseholdName(hhName);
        loadedHouseholdIdRef.current = hhId;
        const remote = await pullItems(user.id, hhId ?? undefined);
        if (remote && remote.length > 0) {
          const merged = [...localItems];
          for (const r of remote) {
            const idx = merged.findIndex(l => l.id === r.id);
            if (idx === -1) merged.push(r);
            else if (r.addedAt > merged[idx].addedAt) merged[idx] = r;
          }
          setItems(merged);
          const maxId = Math.max(...merged.map(i => i.id), 99);
          setNextId(maxId + 1);
          AsyncStorage.setItem('gogood_items', JSON.stringify(merged));
        }
      }
    };
    loadItems();
    // Restore which sections the user last had open. Default is all-collapsed —
    // only sections the user explicitly opened are remembered across sessions.
    AsyncStorage.getItem('gogood_opened_sections').then(sv => {
      if (sv) {
        const keys: string[] = JSON.parse(sv);
        setOpenedSections(new Set(keys));
      }
      // No saved state → leave openedSections empty = all collapsed (desired default)
    });
  }, [user?.id]);

  useEffect(() => {
    AsyncStorage.setItem('gogood_items', JSON.stringify(items));
    if (user?.id) {
      AsyncStorage.getItem(HOUSEHOLD_KEY).then(hhId => {
        pushItems(items, user.id!, hhId ?? undefined);
      });
    }
  }, [items]);

  useEffect(() => {
    if (!householdId) return;
    const ch = subscribeToHouseholdItems(
      householdId,
      row => {
        const item = fromRow(row) as unknown as Item;
        setItems(prev => prev.some(i => i.id === item.id) ? prev : [...prev, item]);
      },
      row => {
        const item = fromRow(row) as unknown as Item;
        setItems(prev => prev.map(i => i.id === item.id ? item : i));
      },
      id => setItems(prev => prev.filter(i => i.id !== id)),
    );
    return () => { ch.unsubscribe(); };
  }, [householdId]);

  useEffect(() => {
    AsyncStorage.getItem('gogood_stats').then(v => { if (v) setStats(JSON.parse(v)); });
  }, []);

  // Keep scheduled notifications in sync with item list
  useEffect(() => {
    if (items.length === 0) return;
    AsyncStorage.getItem('gogood_notifs').then(v => {
      const enabled = v ? JSON.parse(v).expiry !== false : true;
      rescheduleExpiryNotifications(items, enabled);
    });
  }, [items]);

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
      setBarcodeProcessing(false);
    }
  }, [showBarcodeScanner]);

  useFocusEffect(useCallback(() => {
    // Refresh household state in case user just joined/left from the Household tab.
    // Atomic read + re-pull items if membership changed.
    Promise.all([
      AsyncStorage.getItem(HOUSEHOLD_KEY),
      AsyncStorage.getItem(HOUSEHOLD_NAME_KEY),
    ]).then(([id, name]) => {
      setHouseholdId(id);
      setHouseholdName(name);
      if (id !== loadedHouseholdIdRef.current && user?.id) {
        loadedHouseholdIdRef.current = id;
        pullItems(user.id, id ?? undefined).then(remote => {
          if (remote && remote.length > 0) {
            setItems(remote as unknown as Item[]);
            const maxId = Math.max(...remote.map((i: any) => i.id), 99);
            setNextId(maxId + 1);
            AsyncStorage.setItem('gogood_items', JSON.stringify(remote));
          }
        });
      }
    });

    // Re-read storage in case foodreport restored an item while this screen was backgrounded
    AsyncStorage.getItem('gogood_items').then(val => {
      if (val) {
        try {
          const parsed = JSON.parse(val);
          setItems(parsed.map((i: any, idx: number) => ({
            ...i,
            id: i.id || (200 + idx),
            baseName: i.baseName || i.name || '',
            batch: i.batch || 1,
            addedAt: i.addedAt || Date.now(),
          })));
        } catch {}
      }
    });
    screenFade.setValue(0);
    screenSlide.setValue(24);
    heroScale.setValue(0.94);
    contentOpacity.setValue(0);
    contentSlide.setValue(15);
    Animated.parallel([
      Animated.timing(screenFade,  { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.spring(screenSlide, { toValue: 0, damping: 24, stiffness: 200, useNativeDriver: true }),
      Animated.spring(heroScale,   { toValue: 1, damping: 16, stiffness: 200, useNativeDriver: true }),
    ]).start();
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(contentOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(contentSlide,   { toValue: 0, damping: 22, stiffness: 180, useNativeDriver: true }),
      ]).start();
    }, 100);
  }, []));

  const switchTab = (tab: TabView) => {
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
    let list = activeTab === 'all' ? [...items] : [...items.filter(i => i.category === activeTab)];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(i => i.baseName.toLowerCase().includes(q));
    }
    if (filterFoodCats.length > 0) {
      list = list.filter(i => filterFoodCats.includes(resolveCategory(i)));
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
    if (filterNutrition.includes('highProtein')) list = list.filter(i => i.protein >= 15);
    if (filterNutrition.includes('lowCal'))      list = list.filter(i => i.cal > 0 && i.cal < 150);
    if (filterNutrition.includes('lowCarb'))     list = list.filter(i => i.carbs > 0 && i.carbs < 15);
    if (filterNutrition.includes('highFat'))     list = list.filter(i => i.fat >= 10);
    if (sortBy === 'expiry')      list.sort((a,b) => getDaysLeft(a.expiryDate) - getDaysLeft(b.expiryDate));
    if (sortBy === 'expiryAsc')   list.sort((a,b) => getDaysLeft(b.expiryDate) - getDaysLeft(a.expiryDate));
    if (sortBy === 'alpha')       list.sort((a,b) => (a.baseName||'').localeCompare(b.baseName||''));
    if (sortBy === 'alphaDesc')   list.sort((a,b) => (b.baseName||'').localeCompare(a.baseName||''));
    if (sortBy === 'protein')     list.sort((a,b) => b.protein - a.protein);
    if (sortBy === 'proteinAsc')  list.sort((a,b) => a.protein - b.protein);
    if (sortBy === 'cal')         list.sort((a,b) => b.cal - a.cal);
    if (sortBy === 'calAsc')      list.sort((a,b) => a.cal - b.cal);
    if (sortBy === 'qty')         list.sort((a,b) => b.qtyNum - a.qtyNum);
    if (sortBy === 'qtyAsc')      list.sort((a,b) => a.qtyNum - b.qtyNum);
    if (sortBy === 'recent')      list.sort((a,b) => b.addedAt - a.addedAt);
    if (sortBy === 'oldest')      list.sort((a,b) => a.addedAt - b.addedAt);
    if (sortBy === 'category')    list.sort((a,b) => getFoodCategory(a.baseName).localeCompare(getFoodCategory(b.baseName)));
    return list;
  };

  const filtered        = getFiltered();
  const allInTab        = activeTab === 'all' ? [...items] : items.filter(i => i.category === activeTab);
  const allExpiringSoon = items.filter(i => getDaysLeft(i.expiryDate) <= 3);
  const expiringSoon    = allInTab.filter(i => getDaysLeft(i.expiryDate) <= 3).length;

  const availableFoodCats = [...new Set(allInTab.map(i => resolveCategory(i)))].sort();

  // Whether the list is rendered as flat (no category sections) — sections only exist in category sort with no filters
  const noSections = ['expiry', 'expiryAsc'].includes(sortBy)
    || filterFoodCats.length > 0 || filterExpiry.length > 0 || filterNutrition.length > 0
    || filtered.length === 0;
  const sectKeys = noSections
    ? []
    : [...new Set(filtered.map(i => `${activeTab}_${resolveCategory(i)}`))];

  const collapseAll = () => setOpenedSections(prev => { const n = new Set(prev); sectKeys.forEach(k => n.delete(k)); return n; });
  const expandAll   = () => setOpenedSections(prev => { const n = new Set(prev); sectKeys.forEach(k => n.add(k)); return n; });

  const goodBotMsg = () => {
    if (items.length === 0) return 'add items to get started';
    const urgentCount = items.filter(i => getDaysLeft(i.expiryDate) < 0).length;
    if (urgentCount > 0) return `${urgentCount} item${urgentCount > 1 ? 's' : ''} already expired — rescue what you can 🥀`;
    const allExpiring = items.filter(i => { const d = getDaysLeft(i.expiryDate); return d >= 0 && d <= 3; }).length;
    if (allExpiring >= 3) return `using ${allExpiring} expiring items`;
    if (allExpiring > 0) return `${allExpiring} item${allExpiring > 1 ? 's' : ''} expiring — let's use them 🌱`;
    return `you have ${items.length} item${items.length !== 1 ? 's' : ''} — want a recipe? 🍳`;
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

  const fmtQty = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(1);

  const handleUseAmount = () => {
    if (!useModalItem) return;
    const amount = parseFloat(useAmount);
    if (isNaN(amount) || amount <= 0) return;
    const remaining = useModalItem.qtyNum - amount;
    if (remaining <= 0) {
      setUseModalItem(null);
      setUseAmount('');
      goneGood(useModalItem);
    } else {
      setItems(prev => prev.map(i =>
        i.id === useModalItem.id
          ? { ...i, qtyNum: remaining, qty: `${fmtQty(remaining)} ${i.unit}`.trim() }
          : i
      ));
      // Log the partial use to gone-good history so it counts in the report
      const portionStr = useModalItem.unit
        ? `${fmtQty(amount)} ${useModalItem.unit}`
        : fmtQty(amount);
      AsyncStorage.getItem('gogood_gone_good').then(val => {
        const prev = val ? JSON.parse(val) : [];
        const entry = {
          id: useModalItem.id,
          name: useModalItem.baseName,
          icon: useModalItem.icon,
          date: new Date().toISOString(),
          expiryDate: useModalItem.expiryDate,
          category: resolveCategory(useModalItem),
          storageLocation: useModalItem.category,
          daysLeft: useModalItem.days,
          portion: portionStr,
        };
        AsyncStorage.setItem('gogood_gone_good', JSON.stringify([entry, ...prev]));
      });
      updateStats('goneGood');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      showToast(`${portionStr} used 🌱`);
      setUseModalItem(null);
      setUseAmount('');
    }
  };

  const updateStats = (key: 'goneGood' | 'goneBad' | 'totalAdded') => {
    setStats(prev => { const u = { ...prev, [key]: prev[key] + 1 }; AsyncStorage.setItem('gogood_stats', JSON.stringify(u)); return u; });
  };

  const goneGood = (item: Item) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    animateRemove(item.id, 1, () => {
      setItems(prev => prev.filter(i => i.id !== item.id));
      if (expanded === item.id) setExpanded(null);
      AsyncStorage.getItem('gogood_gone_good').then(val => {
        const prev = val ? JSON.parse(val) : [];
        const entry = { id: item.id, name: item.baseName, icon: item.icon, date: new Date().toISOString(), expiryDate: item.expiryDate, category: resolveCategory(item), storageLocation: item.category, daysLeft: item.days };
        AsyncStorage.setItem('gogood_gone_good', JSON.stringify([entry, ...prev]));
      });
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
        const entry = { id: item.id, name: item.baseName, icon: item.icon, date: new Date().toISOString(), expiryDate: item.expiryDate, storageLocation: item.category, daysLeft: item.days };
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

  const FREE_ITEM_LIMIT = 10;

  const openAdd = () => {
    if (!isPremium && !isHouseholdJoiner && items.length >= FREE_ITEM_LIMIT) {
      showPaywall();
      return;
    }
    const defaultCat: Category = activeTab === 'all' ? 'fridge' : activeTab;
    setForm({ ...emptyForm(), category: defaultCat });
    setEditItem(null);
    loadHistory();
    setShowAdd(true);
  };

  const openEdit = (item: Item) => {
    setForm({
      name: item.baseName, qty: String(item.qtyNum), unit: item.unit,
      expiryDate: item.expiryDate, category: item.category,
      protein: String(item.protein), carbs: String(item.carbs),
      fat: String(item.fat), cal: String(item.cal),
      foodCategory: item.foodCategory || '', icon: item.icon || '',
      servingSize: item.servingSize || '',
    });
    setEditItem(item);
    setShowAdd(true);
  };

  const openBarcodeScanner = async () => {
    if (!isPremium) { showPaywall(); return; }
    try {
      if (cameraPermission?.status === 'denied') {
        Alert.alert(
          'Camera access needed',
          'Please enable camera access in Settings to scan barcodes.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
      if (!cameraPermission?.granted) {
        const result = await requestCameraPermission();
        if (!result.granted) { showToast('Camera permission needed', true); return; }
      }
      setShowAdd(false);
      setBarcodeScanned(false);
      barcodeLockRef.current = false;
      setTimeout(() => setShowBarcodeScanner(true), 300);
    } catch {
      showToast('Could not open camera', true);
    }
  };

  const handleBarcodeScan = async ({ data }: { data: string }) => {
    if (barcodeLockRef.current) return;
    barcodeLockRef.current = true;
    setBarcodeScanned(true);
    setBarcodeProcessing(true);
    setScanSuccess(null);
    setScannedEmoji('🔍');
    const scanStart = Date.now();

    const finishScan = (success: boolean, name: string, emoji: string, formUpdater?: () => void) => {
      if (success) {
        setScannedEmoji(emoji);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      setScanSuccess(success);
      setScannedName(name);
      formUpdater?.();
      setTimeout(() => {
        setBarcodeProcessing(false);
        setShowBarcodeScanner(false);
        setTimeout(() => setShowAdd(true), 300);
      }, 1800);
    };

    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${data}.json?fields=product_name,brands,quantity,serving_size,nutriments,expiration_date,categories_tags`
      );
      const json = await res.json();

      if (json.status !== 1 || !json.product) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setBarcodeProcessing(false);
        setShowBarcodeScanner(false);
        setTimeout(() => {
          Alert.alert(
            'Product not found',
            'This barcode isn\'t in the Open Food Facts database.',
            [
              { text: 'Cancel', style: 'cancel', onPress: () => setBarcodeScanned(false) },
              { text: editItem ? 'Back to edit' : 'Fill in manually', onPress: () => { setShowAdd(true); } },
            ]
          );
        }, 350);
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

      // Extract serving size in grams/ml for fallback calculation
      const servingMatch = (p.serving_size || '').match(/([\d.]+)\s*(g|ml)/i);
      const serving_g = servingMatch ? parseFloat(servingMatch[1]) : null;

      // Per-serving value: prefer _serving field, fall back to _100g × serving_g/100
      const perServing = (key: string): number | null => {
        const sv = n[`${key}_serving`];
        if (sv != null && sv > 0) return Math.round(sv);
        const per100 = n[`${key}_100g`] ?? n[key];
        if (per100 != null && per100 > 0 && serving_g) return Math.round(per100 * serving_g / 100);
        if (per100 != null && per100 > 0) return Math.round(per100);
        return null;
      };

      const cal_ps     = perServing('energy-kcal');
      const protein_ps = perServing('proteins');
      const carbs_ps   = perServing('carbohydrates');
      const fat_ps     = perServing('fat');

      const minWait = Math.max(0, 2000 - (Date.now() - scanStart));
      if (minWait > 0) await new Promise(r => setTimeout(r, minWait));
      finishScan(true, productName, getIcon(productName), () => {
        setForm(f => ({
          ...f,
          name:         name         || f.name,
          qty:          qty          || f.qty,
          unit:         unit         || f.unit,
          expiryDate:   expiryDate   || f.expiryDate,
          foodCategory: offCat       || f.foodCategory,
          cal:     cal_ps     != null ? String(cal_ps)     : f.cal,
          protein: protein_ps != null ? String(protein_ps) : f.protein,
          carbs:   carbs_ps   != null ? String(carbs_ps)   : f.carbs,
          fat:     fat_ps     != null ? String(fat_ps)     : f.fat,
        }));
      });
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setBarcodeProcessing(false);
      setShowBarcodeScanner(false);
      setTimeout(() => {
        Alert.alert(
          'Lookup failed',
          'Couldn\'t reach the product database. Check your connection, or add the item manually.',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setBarcodeScanned(false) },
            { text: 'Add manually', onPress: () => setShowAdd(true) },
          ]
        );
      }, 350);
    }
  };

  const doScanReceipt = async (source: 'camera' | 'library', storeName?: string) => {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') { showToast('Camera permission needed', true); return; }
        // Higher quality for receipts — fine text needs good resolution
        result = await ImagePicker.launchCameraAsync({ base64: true, quality: 1.0 });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') { showToast('Photo library access needed', true); return; }
        result = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 1.0, mediaTypes: ImagePicker.MediaTypeOptions.Images });
      }
      if (result.canceled || !result.assets?.[0]?.base64) { return; }
      // Close the BottomSheet Modal first — iOS only allows one Modal at a time.
      // Wait for its 280ms close animation to fully unmount before showing the overlay.
      setShowAdd(false);
      await new Promise<void>(r => setTimeout(r, 320));
      setScanningReceipt(true);
      const { data: { session } } = await import('../lib/supabase').then(m => m.supabase.auth.getSession());
      if (!session) { showToast('Please sign in to scan receipts', true); setScanningReceipt(false); return; }
      const res = await fetch(`${SUPABASE_URL}/functions/v1/scan-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          imageBase64: result.assets[0].base64,
          mimeType: 'image/jpeg',
          storeName: storeName ?? null,
        }),
      });
      const data = await res.json();
      if (data._debug) console.log('[scan-receipt debug]', JSON.stringify(data._debug, null, 2));
      if (!data.sessionId) {
        Alert.alert(
          'Receipt Not Recognized',
          'Make sure the entire receipt is visible, well-lit, and the text is in focus. Try flattening the receipt on a dark surface.\n\nTip: item number codes on your receipt help us look up exact nutrition info.',
          [{ text: 'Try Again', onPress: () => scanReceipt() }, { text: 'Cancel', style: 'cancel' }],
        );
        setScanningReceipt(false);
        return;
      }
      router.push({ pathname: '/receipt-review', params: { sessionId: data.sessionId, storeName: storeName ?? '' } } as any);
    } catch {
      showToast('Receipt scan failed — check your connection', true);
    }
    setScanningReceipt(false);
  };

  const scanReceipt = () => {
    if (!isAnnual) { showPaywall(); return; }
    Alert.alert(
      'Scan Walmart Receipt',
      'Choose how to add your receipt. Item codes on the receipt are used to look up exact nutrition info.',
      [
        { text: '📷  Take Photo',    onPress: () => doScanReceipt('camera',  'Walmart') },
        { text: '🖼️  Photo Library', onPress: () => doScanReceipt('library', 'Walmart') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const scanLabel = async () => {
    setScanning(true);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { showToast('Camera permission needed', true); setScanning(false); return; }
      const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 });
      if (result.canceled || !result.assets?.[0]?.base64) { setScanning(false); return; }
      setShowAdd(false);
      await new Promise<void>(r => setTimeout(r, 320));
      setScanningLabel(true);
      const labelStart = Date.now();
      const base64 = result.assets[0].base64!;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/goodbot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON}` },
        body: JSON.stringify({
          systemPrompt: 'You are an expiry date extractor. Respond ONLY with raw JSON — no markdown, no explanation.',
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
              { type: 'text', text: 'Find any best-by, use-by, sell-by, or expiry date printed on this label. Convert it to YYYY-MM-DD format. If only month and year are visible (e.g. "MAY 2026" or "05/26"), use the last day of that month. If only month/day with no year, assume the nearest future year. Return ONLY: {"expiryDate":"YYYY-MM-DD"}. If no date is found return {"expiryDate":""}.' },
            ],
          }],
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      if (!data.content?.[0]?.text) throw new Error('Empty response');
      const json = JSON.parse(data.content[0].text.replace(/```json|```/g, '').trim());
      const labelWait = Math.max(0, 2500 - (Date.now() - labelStart));
      if (labelWait > 0) await new Promise(r => setTimeout(r, labelWait));
      setScanningLabel(false);
      setTimeout(() => setShowAdd(true), 320);
      if (!json.expiryDate) { showToast('No expiry date found on label', true); setScanning(false); return; }
      setForm(f => ({ ...f, expiryDate: json.expiryDate }));
      showToast('Expiry date captured! 📅');
    } catch (e: any) {
      setScanningLabel(false);
      setTimeout(() => setShowAdd(true), 320);
      showToast(`Scan failed: ${e.message || 'unknown error'}`, true);
    }
    setScanning(false);
  };

  const saveToHistory = async (item: Item) => {
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      const prev: HistoryItem[] = raw ? JSON.parse(raw) : [];
      const entry: HistoryItem = {
        id: String(Date.now()),
        name: item.baseName || item.name,
        icon: item.icon,
        unit: item.unit,
        category: item.category,
        foodCategory: item.foodCategory || '',
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        cal: item.cal,
        servingSize: item.servingSize || undefined,
        savedAt: Date.now(),
      };
      // Deduplicate by name — keep most recent occurrence only
      const deduped = prev.filter(h => h.name.toLowerCase() !== entry.name.toLowerCase());
      // Prune to last 30 days and cap at 200 entries
      const cutoff = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
      const next = [entry, ...deduped].filter(h => h.savedAt >= cutoff).slice(0, 200);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {}
  };

  const loadHistory = async () => {
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      if (!raw) return;
      const all: HistoryItem[] = JSON.parse(raw);
      const cutoff = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
      setItemHistory(all.filter(h => h.savedAt >= cutoff).slice(0, 50));
    } catch {}
  };

  const prefillFromHistory = (h: HistoryItem) => {
    Haptics.selectionAsync();
    setForm(f => ({
      ...f,
      name: h.name,
      icon: h.icon,
      unit: h.unit,
      category: h.category,
      foodCategory: h.foodCategory,
      protein: h.protein > 0 ? String(h.protein) : '',
      carbs:   h.carbs   > 0 ? String(h.carbs)   : '',
      fat:     h.fat     > 0 ? String(h.fat)     : '',
      cal:     h.cal     > 0 ? String(h.cal)     : '',
      servingSize: h.servingSize || '',
    }));
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
      icon:       form.icon || getIcon(safeName),
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
      qtyNum:   parseFloat(form.qty)      || 1,
      unit:     form.unit,
      addedAt:      editItem ? editItem.addedAt : Date.now(),
      foodCategory: form.foodCategory || getFoodCategory(safeName),
      servingSize:  form.servingSize || undefined,
      category: (() => {
        const fc = form.foodCategory || getFoodCategory(safeName);
        return fc === 'Leftovers' ? 'fridge' : form.category;
      })(),
    };

    const doSave = (item: Item) => {
      if (editItem) {
        setItems(prev => prev.map(i => i.id === editItem.id ? item : i));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(`${safeName} updated ✏️`);
      } else {
        setItems(prev => [...prev, item]);
        setNextId(prev => prev + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        triggerSuccess();
        showToast(`${safeName} added! 🌱`);
        updateStats('totalAdded');
      }
      setShowAdd(false);
      saveToHistory(item);
      setLastSaved(item);
      setTimeout(() => setShowSaveConfirm(true), 350);
    };

    const warning = getStorageWarning(safeName, built.category);
    if (warning) {
      Alert.alert(
        'Heads up — storage mismatch',
        warning,
        [
          { text: 'Change location', style: 'cancel' },
          { text: 'Store here anyway', onPress: () => doSave(built) },
        ]
      );
    } else {
      doSave(built);
    }
  };

  const toggleSection = (key: string) => {
    LayoutAnimation.configureNext({
      duration: 60,
      create:  { type: 'linear', property: 'opacity' },
      update:  { type: 'linear' },
      delete:  { type: 'linear', property: 'opacity' },
    });
    setOpenedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      AsyncStorage.setItem('gogood_opened_sections', JSON.stringify([...next]));
      return next;
    });
  };

  // Renders category rows (with collapse) for a given list of items.
  // locPrefix makes category keys unique per-location in the All view.
  const renderCategorySection = (sectionItems: Item[], locPrefix = '') => {
    const grouped: Record<string, Item[]> = {};
    sectionItems.forEach(item => {
      const cat = resolveCategory(item);
      (grouped[cat] = grouped[cat] || []).push(item);
    });
    return CATEGORY_ORDER
      .filter(cat => grouped[cat]?.length > 0)
      .map(cat => {
        const key      = `${activeTab}_${locPrefix ? `${locPrefix}::${cat}` : cat}`;
        const group    = [...grouped[cat]].sort((a, b) => {
          if (sortBy === 'alpha')       return (a.baseName||'').localeCompare(b.baseName||'');
          if (sortBy === 'alphaDesc')   return (b.baseName||'').localeCompare(a.baseName||'');
          if (sortBy === 'protein')     return b.protein - a.protein;
          if (sortBy === 'proteinAsc')  return a.protein - b.protein;
          if (sortBy === 'cal')         return b.cal - a.cal;
          if (sortBy === 'calAsc')      return a.cal - b.cal;
          if (sortBy === 'qty')         return b.qtyNum - a.qtyNum;
          if (sortBy === 'qtyAsc')      return a.qtyNum - b.qtyNum;
          if (sortBy === 'recent')      return b.addedAt - a.addedAt;
          if (sortBy === 'oldest')      return a.addedAt - b.addedAt;
          return getDaysLeft(a.expiryDate) - getDaysLeft(b.expiryDate); // default: soonest first
        });
        const collapsed = !openedSections.has(key);
        return (
          <View key={key}>
            <TouchableOpacity
              style={[styles.categoryHeader, locPrefix ? styles.categoryHeaderNested : undefined]}
              onPress={() => toggleSection(key)}
              activeOpacity={0.7}
            >
              <Text style={styles.categoryHeaderEmoji}>{CATEGORY_ICONS[cat] || '🥘'}</Text>
              <Text style={[styles.categoryHeaderText, { color: colors.textSub }]}>{cat}</Text>
              <View style={[styles.categoryHeaderLine, { backgroundColor: colors.border }]} />
              <Text style={[styles.categoryHeaderCount, { color: colors.textMuted }]}>{group.length}</Text>
              <Text style={[styles.categoryChevron, { color: colors.textMuted }]}>
                {collapsed ? '›' : '⌄'}
              </Text>
            </TouchableOpacity>
            {!collapsed && group.map(item => renderItemCard(item))}
          </View>
        );
      });
  };

  const renderItems = () => {
    const isFlat = ['expiry', 'expiryAsc'].includes(sortBy) || filterFoodCats.length > 0 || filterExpiry.length > 0 || filterNutrition.length > 0;

    // ── Flat / sorted mode ─────────────────────────────────────────
    if (isFlat) {
      const LOC_ICON: Record<Category, string> = { fridge: '❄️', freezer: '🧊', pantry: '🥫' };
      return (
        <>
          {filtered.map(item => (
            <View key={item.id}>
              {activeTab === 'all' && (
                <View style={styles.locationTag}>
                  <Text style={{ fontSize: 9 }}>{LOC_ICON[item.category]}</Text>
                  <Text style={[styles.locationTagText, { color: colors.textMuted }]}>{item.category}</Text>
                </View>
              )}
              {renderItemCard(item)}
            </View>
          ))}
        </>
      );
    }

    // ── Category tree (all tabs) ────────────────────────────────────
    return <>{renderCategorySection(filtered)}</>;
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
        onPress={() => {
          Haptics.selectionAsync();
          LayoutAnimation.configureNext({
            duration: 180,
            create:  { type: 'easeInEaseOut', property: 'opacity' },
            update:  { type: 'spring', springDamping: 0.8 },
            delete:  { type: 'easeInEaseOut', property: 'opacity' },
          });
          setExpanded(prev => prev === item.id ? null : item.id);
        }}
        activeOpacity={0.7}
      >
        <View style={[styles.iconWrap, { backgroundColor: iconBg[liveBadge] }]}>
          <Text style={styles.itemIcon}>{item.icon}</Text>
        </View>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemName, liveBadge === 'black' && { color: '#6B6860' }]}>
            {item.baseName}
            {item.batch > 1 && <Text style={styles.batchInline}> · batch {item.batch}</Text>}
          </Text>
          <Text style={styles.itemQty}>{item.unit ? `${item.qtyNum} ${item.unit}` : item.qty || item.qtyNum}</Text>
        </View>
        <View style={styles.itemRight}>
          <View style={[styles.badge, { backgroundColor: iconBg[liveBadge] }]}>
            <Text style={[styles.badgeText, { color: badgeSoft[liveBadge].text }]}>{liveExpires}</Text>
          </View>
          {expanded !== item.id && <Text style={styles.tapDetails}>tap for details</Text>}
        </View>
      </TouchableOpacity>

      {expanded === item.id && (
        <View style={styles.itemDetail}>
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>quantity</Text>
            <View style={styles.qtyControls}>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => changeQty(item.id, -1)}>
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qtyNum}>{fmtQty(item.qtyNum)} {item.unit}</Text>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => changeQty(item.id, 1)}>
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          {item.servingSize ? (
            <Text style={{ fontSize: 10, color: colors.textMuted, textAlign: 'center' }}>serving: {item.servingSize}</Text>
          ) : null}
          <TouchableOpacity
            onPress={() => { setUseModalItem(item); setUseAmount(''); }}
            style={{ paddingTop: 4, paddingBottom: 2, alignSelf: 'center' }}
            activeOpacity={0.6}
          >
            <Text style={{ fontSize: 11, color: colors.teal, fontWeight: '600' }}>use a portion →</Text>
          </TouchableOpacity>
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
    <View style={styles.safeArea}>
      <ScanStatusStrip visible={scanningReceipt} label="scanning receipt" sublabel="Reading items & looking up nutrition…" />
      <ScanStatusStrip visible={scanningLabel}   label="reading label"    sublabel="Extracting expiry date…" />
      <BarcodeScanStrip visible={barcodeProcessing} scanSuccess={scanSuccess} scannedEmoji={scannedEmoji} scannedName={scannedName} />
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
        <Animated.View style={{ transform: [{ scale: heroScale }] }}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          {menuBtn}
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
        </Animated.View>

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
          {(['all', 'fridge', 'freezer', 'pantry'] as const).map(tab => (
            <TouchableOpacity key={tab} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => switchTab(tab)}>
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === 'all' ? '🗂️' : tab === 'fridge' ? '❄️' : tab === 'freezer' ? '🧊' : '🥫'} {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>


        <Animated.View style={{ flex: 1, opacity: contentOpacity, transform: [{ translateY: contentSlide }] }}>
        {/* ── Sort bar ── */}
        <View style={styles.sortBar}>
          <View style={styles.sortBarLeft}>
            {allExpiringSoon.length > 0 ? (
              <TouchableOpacity style={styles.expiringBadge} onPress={() => setShowExpiringDetail(true)}>
                <Text style={styles.expiringBadgeText}>{allExpiringSoon.length} expiring soon</Text>
              </TouchableOpacity>
            ) : (
              !['expiry','expiryAsc'].includes(sortBy) && filterFoodCats.length === 0 && filterExpiry.length === 0 && filterNutrition.length === 0 && filtered.length > 0 && (() => {
                const sectionKeys = [...new Set(filtered.map(i => `${activeTab}_${resolveCategory(i)}`))];
                const allCollapsed = sectionKeys.length > 0 && sectionKeys.every(k => !openedSections.has(k));
                return (
                  <TouchableOpacity
                    onPress={() => {
                      if (allCollapsed) {
                        setOpenedSections(prev => { const n = new Set(prev); sectionKeys.forEach(k => n.add(k)); return n; });
                      } else {
                        setOpenedSections(prev => { const n = new Set(prev); sectionKeys.forEach(k => n.delete(k)); return n; });
                      }
                    }}
                  >
                    <Text style={[styles.collapseAllText, { color: colors.teal }]}>
                      {allCollapsed ? '⊕ expand all' : '⊖ collapse all'}
                    </Text>
                  </TouchableOpacity>
                );
              })()
            )}
          </View>
          <Text style={styles.sortBarLabel}>{SORT_LABELS[sortBy].toUpperCase()}</Text>
          <View style={styles.sortBarRight}>
            <TouchableOpacity
              style={styles.sortFilterBtn}
              onPress={() => setShowSortFilter(true)}
            >
              {(filterExpiry.length + filterFoodCats.length + filterNutrition.length) > 0 && (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>
                    {filterExpiry.length + filterFoodCats.length + filterNutrition.length}
                  </Text>
                </View>
              )}
              <Text style={styles.sortFilterBtnText}>sort & filter ↕</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Items ── */}
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 4, paddingBottom: 12 }}>
          <Animated.View style={{ opacity: listFade, transform: [{ translateY: listSlide }] }}>
            {filtered.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>{activeTab === 'all' ? '🗂️' : activeTab === 'freezer' ? '🧊' : activeTab === 'pantry' ? '🥫' : '❄️'}</Text>
                <Text style={styles.emptyTitle}>{searchQuery || filterFoodCats.length > 0 || filterExpiry.length > 0 || filterNutrition.length > 0 ? 'No matches' : 'Nothing here yet'}</Text>
                <Text style={styles.emptySub}>{searchQuery || filterFoodCats.length > 0 || filterExpiry.length > 0 || filterNutrition.length > 0 ? 'Try adjusting your search or filters' : 'Tap + to add your first item'}</Text>
                {!searchQuery && filterFoodCats.length === 0 && filterExpiry.length === 0 && filterNutrition.length === 0 && items.length === 0 && (
                  <TouchableOpacity
                    onPress={async () => {
                      await seedSampleItems();
                      const raw = await AsyncStorage.getItem('gogood_items');
                      if (raw) setItems(JSON.parse(raw));
                      showToast('25 sample items loaded 🥦');
                    }}
                    style={{ marginTop: 8 }}
                  >
                    <Text style={{ fontSize: 13, color: colors.teal, fontWeight: '600' }}>
                      Load 25 sample items →
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : renderItems()}
          </Animated.View>
        </ScrollView>

        {/* ── Good Bot CTA ── */}
        <View style={styles.goodBotWrapper}>
          <TouchableOpacity style={styles.goodBotBtn} onPress={() => {
            if (items.length === 0) { openAdd(); return; }
            if (!isPremium) { showPaywall(); return; }
            router.navigate('/(tabs)/goodbot' as any);
          }}>
            <View style={styles.goodBotLeft}>
              <View style={styles.goodBotAvatarWrap}>
                <Text style={{ fontSize: 15 }}>🤖</Text>
              </View>
              <View>
                <Text style={styles.goodBotText}>Ask Good Bot what to make</Text>
                <Text style={styles.goodBotSub}>{goodBotMsg()}</Text>
              </View>
            </View>
            <Text style={styles.goodBotArrow}>→</Text>
          </TouchableOpacity>
        </View>

        </Animated.View>

        {drawerEl}

        {/* ── Use a Portion ── */}
        <BottomSheet visible={!!useModalItem} onClose={() => { setUseModalItem(null); setUseAmount(''); }}>
          <Text style={styles.modalTitle}>Use a portion</Text>
          <Text style={{ color: colors.textSub, fontSize: 13, marginBottom: 16 }}>
            You have: {fmtQty(useModalItem?.qtyNum ?? 0)}{useModalItem?.unit ? ` ${useModalItem.unit}` : ''}
          </Text>
          <Text style={styles.fieldLabel}>How much did you use?</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TextInput
              style={[styles.input, { flex: 1, color: colors.inputText, backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}
              value={useAmount}
              onChangeText={setUseAmount}
              keyboardType="decimal-pad"
              placeholder={useModalItem?.unit ? `e.g. 8` : 'e.g. 1'}
              placeholderTextColor={colors.placeholder}
              autoFocus
            />
            {useModalItem?.unit ? (
              <Text style={{ fontSize: 15, color: colors.text, fontWeight: '500', minWidth: 36 }}>
                {useModalItem.unit}
              </Text>
            ) : null}
          </View>
          {useAmount !== '' && !isNaN(parseFloat(useAmount)) && (
            <Text style={{ fontSize: 13, color: colors.textSub, marginTop: 8 }}>
              {parseFloat(useAmount) >= (useModalItem?.qtyNum ?? 0)
                ? '→ This will mark it as gone good 🌱'
                : `→ ${fmtQty((useModalItem?.qtyNum ?? 0) - parseFloat(useAmount))}${useModalItem?.unit ? ` ${useModalItem.unit}` : ''} remaining`}
            </Text>
          )}
          <TouchableOpacity style={[styles.addConfirmBtn, { marginTop: 16 }]} onPress={handleUseAmount}>
            <Text style={styles.addConfirmText}>
              {!isNaN(parseFloat(useAmount)) && parseFloat(useAmount) >= (useModalItem?.qtyNum ?? 0)
                ? 'Mark gone good 🌱'
                : 'Use it →'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => { setUseModalItem(null); setUseAmount(''); }}>
            <Text style={styles.cancelText}>cancel</Text>
          </TouchableOpacity>
        </BottomSheet>

        {/* ── Add / Edit ── */}
        <BottomSheet visible={showAdd} onClose={() => setShowAdd(false)}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: SCREEN_H * 0.72 }} contentContainerStyle={{ paddingBottom: 180 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text style={styles.modalTitle}>{editItem ? 'Edit item' : 'Add item'}</Text>
            </View>
            {editItem ? (
              <>
                <TouchableOpacity style={[styles.scanBtn, styles.scanBtnBarcode, { marginBottom: 6 }]} onPress={openBarcodeScanner}>
                  <Text style={styles.scanBtnText}>🏷️ Scan barcode to update nutrition</Text>
                </TouchableOpacity>
                <Text style={styles.scanHint}>Fills in nutrition, name, and quantity from the product barcode</Text>
              </>
            ) : (
              <>
                <View style={styles.scanRow}>
                  <TouchableOpacity style={[styles.scanBtn, styles.scanBtnBarcode]} onPress={openBarcodeScanner}>
                    <Text style={styles.scanBtnText}>🏷️ Barcode</Text>
                  </TouchableOpacity>
                  <Animated.View style={{ flex: 1, opacity: scanPulse }}>
                    <TouchableOpacity style={[styles.scanBtn, { width: '100%' }]} onPress={scanLabel} disabled={scanning}>
                      <Text style={styles.scanBtnText}>{scanning ? '⏳...' : '📷 Label'}</Text>
                    </TouchableOpacity>
                  </Animated.View>
                  <TouchableOpacity
                    style={[styles.scanBtn, { backgroundColor: colors.brand }]}
                    onPress={scanReceipt}
                    disabled={scanningReceipt}
                  >
                    <Text style={styles.scanBtnText}>🧾 Receipt</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.scanHint}>Barcode · Label · Receipt — all fill the form automatically</Text>
              </>
            )}
            {!editItem && itemHistory.length > 0 && (
              <>
                <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Recent items</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
                  {itemHistory.map(h => (
                    <TouchableOpacity
                      key={h.id}
                      onPress={() => prefillFromHistory(h)}
                      style={{ alignItems: 'center', padding: 8, borderRadius: 12, borderWidth: 0.5, borderColor: colors.border, backgroundColor: colors.surface, minWidth: 60, maxWidth: 84 }}
                    >
                      <Text style={{ fontSize: 26 }}>{h.icon}</Text>
                      <Text numberOfLines={2} style={{ fontSize: 9, color: colors.text, fontWeight: '600', marginTop: 3, textAlign: 'center' }}>{h.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
            <Text style={styles.fieldLabel}>Item name</Text>
            <TextInput style={styles.input} placeholder="e.g. Ribeye steak" placeholderTextColor={colors.placeholder} value={form.name} onChangeText={v => setForm(f => ({...f, name: v}))} returnKeyType="next" />
            {(() => {
              const selectedIcon = form.icon || getIcon(form.name || '');
              return (
                <>
                  <Text style={styles.fieldLabel}>Icon</Text>
                  <View style={styles.iconPickerRow}>
                    <View style={styles.iconPickerPreview}>
                      <Text style={{ fontSize: 26 }}>{selectedIcon}</Text>
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      style={styles.iconPickerScroll}
                      contentContainerStyle={{ gap: 6, paddingRight: 8 }}
                    >
                      {FOOD_EMOJIS.map((emoji, i) => (
                        <TouchableOpacity
                          key={`${emoji}-${i}`}
                          style={[styles.iconChip, selectedIcon === emoji && styles.iconChipActive]}
                          onPress={() => { Haptics.selectionAsync(); setForm(f => ({ ...f, icon: emoji })); }}
                        >
                          <Text style={{ fontSize: 22 }}>{emoji}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </>
              );
            })()}
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
            <Text style={styles.fieldLabel}>Serving size</Text>
            <TextInput style={styles.input} placeholder="e.g. 1/4 cup, 1 tbsp, 100g" placeholderTextColor={colors.placeholder} value={form.servingSize} onChangeText={v => setForm(f => ({...f, servingSize: v}))} returnKeyType="next" />
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
                    {cat === 'fridge' ? '❄️' : cat === 'freezer' ? '🧊' : '🥫'} {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginTop: 4 }} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
              <TouchableOpacity
                style={[styles.categoryBtn, { flex: 0, paddingHorizontal: 12 }, !form.foodCategory && styles.categoryBtnActive]}
                onPress={() => { Haptics.selectionAsync(); setForm(f => ({ ...f, foodCategory: '' })); }}
              >
                <Text style={[styles.categoryBtnText, !form.foodCategory && styles.categoryBtnTextActive]}>Auto</Text>
              </TouchableOpacity>
              {CATEGORY_ORDER.map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.categoryBtn, { flex: 0, paddingHorizontal: 12 }, form.foodCategory === cat && styles.categoryBtnActive]}
                  onPress={() => { Haptics.selectionAsync(); setForm(f => ({ ...f, foodCategory: cat })); }}
                >
                  <Text style={[styles.categoryBtnText, form.foodCategory === cat && styles.categoryBtnTextActive]}>
                    {CATEGORY_ICONS[cat]} {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
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
                    sortBy === key && { backgroundColor: colors.btnPrimary, borderColor: colors.btnPrimary }
                  ]}
                  onPress={() => { Haptics.selectionAsync(); setSortBy(key); }}
                >
                  <Text style={{ fontSize: 15 }}>{SORT_ICONS[key]}</Text>
                  <Text style={[{ fontSize: 12, color: colors.textSub, fontWeight: '500' }, sortBy === key && { color: 'white' }]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* ── Collapse / Expand All ── */}
            <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Groups</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
              {[
                { label: 'Collapse All', icon: '⊖', onPress: collapseAll },
                { label: 'Expand All',   icon: '⊕', onPress: expandAll   },
              ].map(btn => (
                <TouchableOpacity
                  key={btn.label}
                  style={{
                    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 6, paddingVertical: 11, borderRadius: 12,
                    borderWidth: 1,
                    borderColor: noSections ? colors.border : colors.teal,
                    backgroundColor: noSections ? colors.surface : 'rgba(29,158,117,0.08)',
                    opacity: noSections ? 0.4 : 1,
                  }}
                  disabled={noSections}
                  onPress={() => { btn.onPress(); setShowSortFilter(false); }}
                  activeOpacity={0.75}
                >
                  <Text style={{ fontSize: 15, color: noSections ? colors.textMuted : colors.teal }}>{btn.icon}</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: noSections ? colors.textMuted : colors.teal }}>
                    {btn.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {noSections && (
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 6 }}>
                Switch to "By Category" sort with no filters to use groups.
              </Text>
            )}

            <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Filter by expiry</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {[
                { key: 'expired', emoji: '💀', label: 'Expired',    bg: iconBg.black, text: badgeSoft.black.text },
                { key: 'today',   emoji: '🔴', label: 'Today',      bg: iconBg.red,   text: badgeSoft.red.text   },
                { key: 'soon',    emoji: '🟡', label: '1–3 days',   bg: iconBg.amber, text: badgeSoft.amber.text },
                { key: 'fresh',   emoji: '🟢', label: 'Fresh (4+)', bg: iconBg.green, text: badgeSoft.green.text },
              ].map(e => (
                <TouchableOpacity
                  key={e.key}
                  style={[
                    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
                    filterExpiry.includes(e.key) && { backgroundColor: e.bg, borderColor: 'transparent' }
                  ]}
                  onPress={() => setFilterExpiry(prev =>
                    prev.includes(e.key) ? prev.filter(x => x !== e.key) : [...prev, e.key]
                  )}
                >
                  <Text style={{ fontSize: 9 }}>{e.emoji}</Text>
                  <Text style={[{ fontSize: 12, color: colors.textSub, fontWeight: '500' }, filterExpiry.includes(e.key) && { color: e.text }]}>{e.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {availableFoodCats.length > 0 && (
              <>
                <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Filter by food category</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  {availableFoodCats.map(cat => (
                    <TouchableOpacity
                      key={cat}
                      style={[
                        { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
                        filterFoodCats.includes(cat) && { backgroundColor: colors.btnPrimary, borderColor: colors.btnPrimary }
                      ]}
                      onPress={() => setFilterFoodCats(prev =>
                        prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
                      )}
                    >
                      <Text style={{ fontSize: 13 }}>{CATEGORY_ICONS[cat] || '🥘'}</Text>
                      <Text style={[{ fontSize: 11, color: colors.textSub, fontWeight: '500' }, filterFoodCats.includes(cat) && { color: 'white' }]}>{cat}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Filter by nutrition</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {NUTRITION_FILTERS.map(f => (
                <TouchableOpacity
                  key={f.key}
                  style={[
                    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
                    filterNutrition.includes(f.key) && { backgroundColor: colors.btnPrimary, borderColor: colors.btnPrimary }
                  ]}
                  onPress={() => setFilterNutrition(prev =>
                    prev.includes(f.key) ? prev.filter(x => x !== f.key) : [...prev, f.key]
                  )}
                >
                  <Text style={{ fontSize: 15 }}>{f.emoji}</Text>
                  <View>
                    <Text style={[{ fontSize: 12, color: colors.textSub, fontWeight: '600' }, filterNutrition.includes(f.key) && { color: 'white' }]}>{f.label}</Text>
                    <Text style={[{ fontSize: 10, color: colors.textMuted }, filterNutrition.includes(f.key) && { color: 'rgba(255,255,255,0.7)' }]}>{f.desc}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={{ alignSelf: 'flex-start', marginTop: 14 }}
              onPress={() => { setFilterExpiry([]); setFilterFoodCats([]); setFilterNutrition([]); }}
            >
              <Text style={{ fontSize: 12, color: colors.textMuted }}>clear all filters</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.addConfirmBtn, { marginTop: 24 }]} onPress={() => setShowSortFilter(false)}>
              <Text style={styles.addConfirmText}>Apply →</Text>
            </TouchableOpacity>
            <View style={{ height: 20 }} />
          </ScrollView>
        </BottomSheet>

        {/* ── Barcode Scanner (absolute overlay — avoids iOS "one modal at a time" limit) ── */}
        {showBarcodeScanner && (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000', zIndex: 999 }]}>
            {/* Layer 1 — full-screen live camera feed */}
            <CameraView
              style={StyleSheet.absoluteFillObject}
              facing="back"
              onBarcodeScanned={handleBarcodeScan}
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
            />

            {/* Layer 2 — solid mask with a transparent cutout for the scan window */}
            <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.76)' }} />
              <View style={{ flexDirection: 'row', height: 160 }}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.76)' }} />
                <View style={{ width: 280 }} />
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.76)' }} />
              </View>
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.76)' }} />
            </View>

            {/* Layer 3 — corner marks, scanning beam, and hint text */}
            <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
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
              <Text style={{ color: 'rgba(255,255,255,0.75)', marginTop: 18, fontSize: 13, fontWeight: '500' }}>
                Point at a barcode or QR code
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.4)', marginTop: 5, fontSize: 11 }}>
                UPC · EAN · Code128 supported
              </Text>
            </View>

            {/* Close button */}
            <TouchableOpacity
              style={{ position: 'absolute', top: 60, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}
              onPress={() => { barcodeLockRef.current = false; setShowBarcodeScanner(false); setBarcodeScanned(false); setTimeout(() => setShowAdd(true), 300); }}
            >
              <Text style={{ color: 'white', fontSize: 18, lineHeight: 22 }}>✕</Text>
            </TouchableOpacity>

            {/* Brand */}
            <View style={{ position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' }}>
              <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>powered by Open Food Facts</Text>
            </View>
          </View>
        )}

        {/* ── Expiring Detail ── */}
        <BottomSheet visible={showExpiringDetail} onClose={() => setShowExpiringDetail(false)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={styles.modalTitle}>Expiring Soon</Text>
            <TouchableOpacity onPress={() => setShowExpiringDetail(false)}><Text style={{ fontSize: 18, color: '#aaa' }}>✕</Text></TouchableOpacity>
          </View>
          {!isPremium && (
            <TouchableOpacity
              onPress={() => { setShowExpiringDetail(false); showPaywall(); }}
              style={{ backgroundColor: colors.btnPrimary, borderRadius: 12, padding: 12, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <Text style={{ fontSize: 22 }}>🤖</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#5DCAA5' }}>Turn expiring food into recipes</Text>
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>Good Bot creates meals from what you have — upgrade to Go Good+</Text>
              </View>
              <Text style={{ fontSize: 16, color: '#5DCAA5' }}>›</Text>
            </TouchableOpacity>
          )}
          <ScrollView showsVerticalScrollIndicator={false}>
            {allExpiringSoon.length === 0 ? (
              <Text style={{ color: colors.textSub, textAlign: 'center', paddingVertical: 24 }}>Nothing expiring soon!</Text>
            ) : (
              [...allExpiringSoon].sort((a,b) => getDaysLeft(a.expiryDate) - getDaysLeft(b.expiryDate)).map(item => {
                const liveDays    = getDaysLeft(item.expiryDate);
                const liveBadge   = getBadge(liveDays, item.category);
                const liveExpires = getExpiryText(liveDays);
                return (
                <View key={item.id} style={{ paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: iconBg[liveBadge], alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 22 }}>{item.icon}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>{item.baseName}</Text>
                      <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 2 }}>
                        {item.category.charAt(0).toUpperCase() + item.category.slice(1)} · {item.qty}
                      </Text>
                    </View>
                    <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: badgeSoft[liveBadge].bg }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: badgeSoft[liveBadge].text }}>{liveExpires}</Text>
                    </View>
                  </View>
                  {liveDays < 0 && (
                    <TouchableOpacity
                      style={{ marginTop: 8, alignSelf: 'flex-end', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: 'rgba(232,117,106,0.12)', borderWidth: 1, borderColor: 'rgba(232,117,106,0.3)' }}
                      onPress={() => { setShowExpiringDetail(false); goneBad(item); }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '600', color: '#C0392B' }}>Gone bad 🥀</Text>
                    </TouchableOpacity>
                  )}
                </View>
                );
              })
            )}
            <View style={{ height: 20 }} />
          </ScrollView>
        </BottomSheet>

        {/* ── Save confirmation ── */}
        <BottomSheet visible={showSaveConfirm} onClose={() => setShowSaveConfirm(false)}>
          <Text style={styles.modalTitle}>Does everything look right?</Text>
          {lastSaved && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 14, padding: 14, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 0.5, borderColor: colors.border }}>
              <Text style={{ fontSize: 42 }}>{lastSaved.icon}</Text>
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{lastSaved.baseName}</Text>
                <Text style={{ fontSize: 12, color: colors.textSub }}>
                  {lastSaved.category === 'fridge' ? '❄️' : lastSaved.category === 'freezer' ? '🧊' : '🥫'} {lastSaved.category.charAt(0).toUpperCase() + lastSaved.category.slice(1)}
                  {lastSaved.foodCategory ? `  ·  ${CATEGORY_ICONS[lastSaved.foodCategory] ?? ''} ${lastSaved.foodCategory}` : ''}
                </Text>
                <Text style={{ fontSize: 12, color: colors.textSub }}>
                  📅 {lastSaved.expiryDate || 'No expiry set'}{lastSaved.qty ? `  ·  📦 ${lastSaved.qty}` : ''}
                </Text>
                {(lastSaved.protein > 0 || lastSaved.cal > 0) && (
                  <Text style={{ fontSize: 11, color: colors.textSub }}>
                    {[lastSaved.cal > 0 && `${lastSaved.cal} cal`, lastSaved.protein > 0 && `${lastSaved.protein}g protein`].filter(Boolean).join('  ·  ')}
                  </Text>
                )}
              </View>
            </View>
          )}
          <TouchableOpacity style={styles.addConfirmBtn} onPress={() => setShowSaveConfirm(false)}>
            <Text style={styles.addConfirmText}>Looks good ✓</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.cancelBtn, { marginTop: 8 }]} onPress={() => {
            setShowSaveConfirm(false);
            if (lastSaved) setTimeout(() => openEdit(lastSaved), 350);
          }}>
            <Text style={styles.cancelText}>Edit this item</Text>
          </TouchableOpacity>
        </BottomSheet>

      </Animated.View>
    </View>
  );
}

function createStyles(c: ThemeColors, compact = false, isDark = false) { return StyleSheet.create({
  safeArea:              { flex: 1, backgroundColor: c.bg },
  container:             { flex: 1, backgroundColor: c.bg },
  blastWrap:             { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 },
  blastEmoji:            { position: 'absolute', fontSize: 14 },
  toast:                 { position: 'absolute', bottom: 110, alignSelf: 'center', backgroundColor: c.btnPrimary, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, zIndex: 100 },
  toastBad:              { backgroundColor: '#E24B4A' },
  toastText:             { color: 'white', fontSize: 11, fontWeight: '500' },

  // Header
  header:                { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, backgroundColor: c.bg, borderBottomWidth: 0.5, borderBottomColor: c.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 3 },
  logo:                  { fontSize: 30, fontWeight: '700', color: c.brand, fontFamily: 'Fraunces_600SemiBold' },
  logoGreen:             { color: c.teal, fontFamily: 'Fraunces_600SemiBold' },
  menuBtn:               { width: 32, height: 32, justifyContent: 'center', gap: 5 },
  menuLine:              { width: 20, height: 1.5, backgroundColor: c.text, borderRadius: 999 },
  expiringBadge:         { backgroundColor: '#FFEAEA', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  expiringBadgeText:     { fontSize: 11, fontWeight: '600', color: '#C0392B' },
  addBtn:                { width: 34, height: 34, borderRadius: 17, backgroundColor: c.btnPrimary, alignItems: 'center', justifyContent: 'center', shadowColor: isDark ? '#8DB89A' : '#085041', shadowOffset: { width: 0, height: 5 }, shadowOpacity: isDark ? 0.25 : 0.5, shadowRadius: 14, elevation: 8 },
  addBtnText:            { color: 'white', fontSize: 22, lineHeight: 22, fontWeight: '300', includeFontPadding: false, marginTop: 1 },
  scanIconBtn:           { width: 34, height: 34, borderRadius: 17, backgroundColor: c.teal, alignItems: 'center', justifyContent: 'center', shadowColor: isDark ? '#8DB89A' : '#085041', shadowOffset: { width: 0, height: 5 }, shadowOpacity: isDark ? 0.25 : 0.4, shadowRadius: 12, elevation: 6 },

  // Search
  searchRow:             { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 },
  searchBar:             { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 0.5, borderColor: c.border, gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 4 },
  searchIcon:            { fontSize: 15 },
  searchInput:           { flex: 1, fontSize: 14, color: c.text },

  // Tabs
  tabs:                  { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 10 },
  tab:                   { flex: 1, paddingVertical: 9, borderRadius: 100, backgroundColor: c.surface, borderWidth: 0.5, borderColor: c.border, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.10, shadowRadius: 7, elevation: 3 },
  tabActive:             { backgroundColor: isDark ? '#1D9E75' : c.brand, borderColor: isDark ? '#1D9E75' : c.brand },
  tabText:               { fontSize: 10, fontWeight: '500', color: c.textSub },
  tabTextActive:         { color: 'white', fontWeight: '600' },


  // Sort bar
  sortBar:               { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  collapseAllBtn:        { alignSelf: 'flex-end', paddingHorizontal: 16, paddingBottom: 6, paddingTop: 0 },
  collapseAllText:       { fontSize: 11, fontWeight: '600' },
  sortBarLeft:           { flex: 1, alignItems: 'flex-start' },
  sortBarRight:          { flex: 1, alignItems: 'flex-end' },
  sortBarLabel:          { fontSize: 10, fontWeight: '700', color: c.text, letterSpacing: 0.5 },
  sortFilterBtn:         { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12 },
  sortFilterBtnText:     { fontSize: 12, color: c.teal, fontWeight: '600' },
  filterBadge:           { width: 16, height: 16, borderRadius: 8, backgroundColor: '#E8756A', alignItems: 'center', justifyContent: 'center' },
  filterBadgeText:       { fontSize: 9, color: 'white', fontWeight: '700' },

  // Items
  scroll:                { flex: 1, paddingHorizontal: 16 },
  emptyState:            { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyIcon:             { fontSize: 48 },
  emptyTitle:            { fontSize: 16, fontWeight: '600', color: c.brand },
  emptySub:              { fontSize: 13, color: c.textSub },

  // Flat sort — location mini-tag shown before each item in All view
  locationTag:           { flexDirection: 'row', alignItems: 'center', gap: 3, paddingTop: 2, paddingBottom: 1 },
  locationTagText:       { fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, color: c.textMuted },
  flatListNote:          { fontSize: 10, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', paddingTop: 10, paddingBottom: 4 },

  // Location section (All tab tree — level 1)
  locationSection:       { marginBottom: 6 },
  locationHeader:        {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 11, paddingHorizontal: 10,
    marginBottom: 2,
    backgroundColor: c.surface,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderWidth: 0.5,
    borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 4,
  },
  locationHeaderIcon:    { fontSize: 18 },
  locationHeaderText:    { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  locationHeaderCount:   { fontSize: 11, fontWeight: '500' },
  locationContent:       { paddingLeft: 10 },

  // Category header (level 2 in All, level 1 in individual tabs)
  categoryHeader:        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 12, paddingBottom: 5 },
  categoryHeaderNested:  { paddingTop: 8, paddingBottom: 4 },
  categoryHeaderEmoji:   { fontSize: 13 },
  categoryHeaderText:    { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  categoryHeaderLine:    { flex: 1, height: 0.5 },
  categoryChevron:       { fontSize: 13, fontWeight: '700', width: 16, textAlign: 'center' },
  categoryHeaderCount:   { fontSize: 10, fontWeight: '600' },

  // Item cards
  itemWrapMargin:        { height: compact ? 4 : 8 },
  itemCard:              { backgroundColor: c.surface, borderRadius: compact ? 12 : 16, borderWidth: 0.5, borderColor: c.border, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.16, shadowRadius: 14, elevation: 6 },
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
  qtyRow:                { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qtyLabel:              { fontSize: 10, color: c.textSub },
  qtyControls:           { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn:                { width: 26, height: 26, borderRadius: 13, backgroundColor: c.teal, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText:            { color: 'white', fontSize: 18, lineHeight: 20 },
  qtyNum:                { fontSize: 13, fontWeight: '500', color: c.text, minWidth: 40, textAlign: 'center' },
  actionRow:             { flexDirection: 'row', gap: 6 },
  actionBtn:             { flex: 1, padding: 8, borderRadius: 12, backgroundColor: c.bg, borderWidth: 0.5, borderColor: c.border, alignItems: 'center' },
  actionUsed:            { backgroundColor: c.goneGoodBg, borderColor: isDark ? 'rgba(93,202,165,0.3)' : '#9FE1CB' },
  actionBad:             { backgroundColor: isDark ? 'rgba(245,180,60,0.15)' : '#FAEEDA', borderColor: isDark ? 'rgba(245,180,60,0.3)' : '#FAC775' },
  actionEdit:            { flex: 0, paddingHorizontal: 12, backgroundColor: isDark ? 'rgba(100,160,255,0.15)' : '#E6F1FB', borderColor: isDark ? 'rgba(100,160,255,0.3)' : '#B3D4F5' },
  actionDelete:          { flex: 0, paddingHorizontal: 12, backgroundColor: c.goneBadBg, borderColor: isDark ? 'rgba(240,120,100,0.3)' : '#F7C1C1' },
  actionUsedText:        { fontSize: 10, color: c.goneGoodText, fontWeight: '500' },
  actionBadText:         { fontSize: 10, color: isDark ? '#F5D090' : '#854F0B', fontWeight: '500' },
  actionEditText:        { fontSize: 12, color: isDark ? '#90C0FF' : '#185FA5' },
  actionDeleteText:      { fontSize: 12, color: c.goneBadText },

  // Good Bot CTA
  goodBotWrapper:        { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8, backgroundColor: c.bg },
  goodBotBtn:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.btnPrimary, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 30, shadowColor: '#000000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: isDark ? 0.12 : 0.18, shadowRadius: 6, elevation: 4 },
  goodBotLeft:           { flexDirection: 'row', alignItems: 'center', gap: 10 },
  goodBotAvatarWrap:     { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  goodBotText:           { color: 'white', fontSize: 12, fontWeight: '700' },
  goodBotSub:            { color: 'rgba(255,255,255,0.6)', fontSize: 10, marginTop: 1 },
  goodBotArrow:          { color: '#5DCAA5', fontSize: 16 },

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
  proBadge:              { backgroundColor: c.goneGoodBg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  proBadgeText:          { fontSize: 9, color: c.goneGoodText, fontWeight: '600' },
  logoutBtn:             { paddingVertical: 13, borderRadius: 12, backgroundColor: 'rgba(232,117,106,0.15)', alignItems: 'center', marginTop: 24 },
  logoutText:            { fontSize: 14, color: '#E8756A', fontWeight: '600' },
  drawerVersion:         { fontSize: 10, color: c.textMuted, textAlign: 'center', marginTop: 20 },

  // Modals
  modalTitle:            { fontSize: 16, fontWeight: '600', color: c.brand },
  fieldLabel:            { fontSize: 10, fontWeight: '600', color: c.textSub, textTransform: 'uppercase', letterSpacing: 1, marginTop: 10, marginBottom: 4 },
  input:                 { backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10, padding: 11, fontSize: 14, color: c.inputText },
  scanRow:               { flexDirection: 'row', gap: 8, marginBottom: 6, marginTop: 10 },
  scanBtn:               { flex: 1, backgroundColor: c.btnPrimary, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  scanBtnBarcode:        { backgroundColor: c.teal },
  scanBtnText:           { color: 'white', fontSize: 11, fontWeight: '600' },
  scanHint:              { fontSize: 10, color: c.textMuted, textAlign: 'center', marginBottom: 14 },
  barcodeFrame:          { width: 280, height: 160, borderRadius: 12, position: 'relative' },
  barcodeCorner:         { position: 'absolute', width: 24, height: 24, borderColor: '#5DCAA5', borderRadius: 2 },
  iconPickerRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  iconPickerPreview:     { width: 46, height: 46, borderRadius: 12, backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iconPickerScroll:      { flex: 1 },
  iconChip:              { width: 40, height: 40, borderRadius: 10, backgroundColor: c.bg, borderWidth: 0.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  iconChipActive:        { borderColor: c.btnPrimary, borderWidth: 2, backgroundColor: c.inputBg },
  categoryRow:           { flexDirection: 'row', gap: 6, marginTop: 4 },
  categoryBtn:           { flex: 1, padding: 8, borderRadius: 100, backgroundColor: c.bg, borderWidth: 0.5, borderColor: c.border, alignItems: 'center' },
  categoryBtnActive:     { backgroundColor: c.btnPrimary, borderColor: c.btnPrimary },
  categoryBtnText:       { fontSize: 10, fontWeight: '500', color: c.textSub },
  categoryBtnTextActive: { color: 'white' },
  addConfirmBtn:         { backgroundColor: c.teal, padding: 14, borderRadius: 14, alignItems: 'center', marginTop: 12 },
  addConfirmText:        { color: 'white', fontSize: 14, fontWeight: '600' },
  cancelBtn:             { alignItems: 'center', padding: 10 },
  cancelText:            { fontSize: 13, color: c.textMuted },

  // Overlays
  successOverlay:        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  successCircle:         { width: 88, height: 88, borderRadius: 44, backgroundColor: c.teal, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 10 },
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
