# Go Good Feature Spec

## 1. Recipe Collections
### User Story
As a user, I want to save my favorite Good Bot recipes into collections so I can easily find and reuse them later for faster meal planning.

### Acceptance Criteria
- User can save a recipe to a new or existing collection from the recipe screen
- User can view, rename, and delete their collections in a "Recipe Collections" tab
- User can browse recipes within a collection
- Adding a recipe to a collection does not duplicate it in the main recipe list

### Implementation Notes
- Create a new "Collections" table in the database to store collection names and ids
- Create a many-to-many relationship between "Recipes" and "Collections" tables
- Update the Good Bot recipe screen with an "Add to Collection" button
- Create a new "Recipe Collections" tab in the main navigation

## 2. Collaborative Lists
### User Story
As a user, I want to share my Go Good inventory with my family/roommates so we can all see and update what we have without texting back and forth.

### Acceptance Criteria
- User can invite others to share their inventory via email/phone number
- Invited users can view and edit the shared inventory in real-time
- Changes sync instantly across all shared devices
- Users can leave a shared inventory at any time

### Implementation Notes
- Add "household" field to the users table
- Inventories are linked to households, not individual users
- Create a "Manage Household" screen to invite/remove members
- Use websockets to instantly sync inventory changes across devices

## 3. Waste Insights
### User Story
As a user, I want to see the dollar value of food I've wasted so I'm motivated to change my habits and waste less.

### Acceptance Criteria
- Food Report shows a "Wasted This Month" metric in dollars
- Metric auto-updates when items are logged as "gone bad"
- User can tap the metric for an itemized list of what was wasted
- Metric resets on the 1st of each month

### Implementation Notes
- Add a "price" field to the items table (optional, can be sourced from online if not provided)
- When an item is logged as "gone bad", add its price to a running "wasted_value" tally for the current month
- Display this tally in the Food Report UI
- Create an "Itemized Waste" screen showing the individual wasted items
- Create a cron job to reset the waste tally on the 1st of each month

## 4. Good Bot Macros & Adaptive Recipes
### User Story
As a user, I want Good Bot to give me the macros for each recipe it suggests based on what's in my actual inventory. I don't need to see the macros in the main inventory view.

### Acceptance Criteria
- Macros are removed from the main inventory screen
- When Good Bot suggests a recipe, it shows the total macros for that recipe based on the user's inventory quantities
- If the user is missing an ingredient, Good Bot adapts the recipe and macros

### Implementation Notes
- Remove the macros UI from the Fridge/Pantry/Freezer screens
- When generating a recipe, query the user's inventory quantities for each ingredient
- Multiply the quantity by the ingredient's macro ratios to get total recipe macros
- If an ingredient is missing, adjust the recipe and recalculate macros
- Display the total recipe macros in the Good Bot recipe screen
