// Cooking preferences in the user's profile. Good Bot uses them to shape every
// recipe: allergies are hard rules, the rest are preferences.

export interface CookingPrefs {
  allergies:      string[];  // from ALLERGY_OPTIONS
  otherAllergies: string;    // anything not in the list, free text
  dislikes:       string;    // free text, e.g. "mushrooms, cilantro"
  equipment:      string[];  // from EQUIPMENT_OPTIONS
  time:           string;    // from TIME_OPTIONS keys ('' = no limit)
  goals:          string[];  // from GOAL_OPTIONS
  skill:          string;    // from SKILL_OPTIONS keys ('' = not set)
  cuisines:       string[];  // from CUISINE_OPTIONS
  spice:          string;    // from SPICE_OPTIONS keys ('' = not set)
  household:      string[];  // from HOUSEHOLD_OPTIONS (kids, picky eaters)
}

export const EMPTY_COOKING: CookingPrefs = {
  allergies: [], otherAllergies: '', dislikes: '', equipment: [], time: '',
  goals: [], skill: '', cuisines: [], spice: '', household: [],
};

export const ALLERGY_OPTIONS   = ['Peanuts', 'Tree nuts', 'Shellfish', 'Fish', 'Eggs', 'Milk', 'Soy', 'Wheat', 'Sesame'];
export const EQUIPMENT_OPTIONS = ['Oven', 'Stovetop', 'Microwave', 'Air fryer', 'Instant Pot', 'Slow cooker', 'Blender', 'Grill'];
export const TIME_OPTIONS      = [{ key: '15', label: '15 min' }, { key: '30', label: '30 min' }, { key: '45', label: '45 min' }, { key: '', label: 'No limit' }];
export const GOAL_OPTIONS      = ['High protein', 'Lower calorie', 'Low carb', 'Low sodium', 'Low sugar', 'High fiber'];
export const SKILL_OPTIONS     = [{ key: 'beginner', label: 'Beginner' }, { key: 'comfortable', label: 'Comfortable' }, { key: 'confident', label: 'Confident' }];
export const CUISINE_OPTIONS   = ['American', 'Mexican', 'Italian', 'Mediterranean', 'Chinese', 'Japanese', 'Korean', 'Thai', 'Indian', 'Middle Eastern', 'Southern', 'Caribbean'];
export const SPICE_OPTIONS     = [{ key: 'mild', label: 'Mild' }, { key: 'medium', label: 'Medium' }, { key: 'hot', label: 'Hot' }];
export const HOUSEHOLD_OPTIONS = ['Kids at home', 'Picky eaters'];

const strList = (v: unknown, allowed?: string[]) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && (!allowed || allowed.includes(x))) : [];
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Accepts anything (old profiles, the database) and returns a complete, valid object. */
export function normalizeCooking(v: unknown): CookingPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const oneOf = (x: unknown, keys: string[]) => (typeof x === 'string' && keys.includes(x) ? x : '');
  return {
    allergies:      strList(o.allergies, ALLERGY_OPTIONS),
    otherAllergies: str(o.otherAllergies),
    dislikes:       str(o.dislikes),
    equipment:      strList(o.equipment, EQUIPMENT_OPTIONS),
    time:           oneOf(o.time, TIME_OPTIONS.map(t => t.key)),
    goals:          strList(o.goals, GOAL_OPTIONS),
    skill:          oneOf(o.skill, SKILL_OPTIONS.map(t => t.key)),
    cuisines:       strList(o.cuisines, CUISINE_OPTIONS),
    spice:          oneOf(o.spice, SPICE_OPTIONS.map(t => t.key)),
    household:      strList(o.household, HOUSEHOLD_OPTIONS),
  };
}

/** True when nothing has been filled in. */
export function isCookingEmpty(c: CookingPrefs): boolean {
  return !c.allergies.length && !c.otherAllergies.trim() && !c.dislikes.trim() && !c.equipment.length && !c.time
    && !c.goals.length && !c.skill && !c.cuisines.length && !c.spice && !c.household.length;
}
