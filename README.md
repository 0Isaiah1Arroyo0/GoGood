# GoGood

A React Native mobile app that helps you track your food, cut waste, and watch your money go good.

GoGood lets you log everything in your fridge, freezer, and pantry, shows you what's expiring soon, and helps you plan meals around what you already have — so less food ends up in the trash and more money stays in your pocket.

---

## Features

- **Food Inventory** — Track items across fridge, freezer, and pantry with expiry dates, quantities, and nutrition info
- **Expiry Alerts** — Color-coded badges (green / yellow / red) and push notifications when food is about to expire
- **Good Bot** — AI-powered assistant that answers cooking questions, suggests recipes from what you have, and helps you go good
- **Recipe Collections** — Save, rate, and organize recipes; share with your household
- **Household Sharing** — Invite family or roommates to a shared inventory and shopping list
- **Shopping List** — Collaborative list that syncs across your household in real time
- **Receipt Scanning** — Photograph a grocery receipt and automatically add items to your inventory
- **Store Connections** — Connect your Kroger account to import purchases directly
- **Social Recipe Import** — Paste a link to any recipe page and save it to your collections
- **Food Report** — Weekly stats on what you saved, what went bad, and your waste trends
- **Subscriptions** — Free tier with premium upgrade via RevenueCat (monthly / annual)
- **Biometric Login** — Face ID / Touch ID for instant sign-in
- **Light & Dark Theme** — System-aware with manual toggle

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo (SDK 52) |
| Navigation | Expo Router (file-based) |
| Backend | Supabase (Postgres, Auth, Edge Functions, Realtime) |
| Language | TypeScript |
| Fonts | Fraunces + DM Sans (Google Fonts) |
| Subscriptions | RevenueCat |
| Email | Resend |
| AI | Anthropic Claude API |
| Barcode / Camera | expo-camera, expo-image-picker |
| Auth | Supabase Auth (email, Apple Sign-In, biometric) |
| Storage | AsyncStorage + Supabase Postgres |

---

## Project Structure

```
gogood/
├── app/
│   ├── (tabs)/               # Bottom tab screens
│   │   ├── index.tsx         # Food inventory (home)
│   │   ├── goodbot.tsx       # AI assistant
│   │   ├── shopping.tsx      # Shopping list
│   │   ├── collections.tsx   # Recipe collections
│   │   ├── household.tsx     # Household management
│   │   └── foodreport.tsx    # Waste & savings report
│   ├── auth/                 # Auth screens
│   │   ├── welcome.tsx
│   │   ├── login.tsx
│   │   ├── signup.tsx
│   │   ├── confirm.tsx       # Email confirmation deep-link handler
│   │   ├── reset.tsx         # Password reset deep-link handler
│   │   └── biometric.tsx
│   ├── components/           # Shared UI components
│   ├── context/              # React context providers
│   │   ├── auth.tsx
│   │   ├── theme.tsx
│   │   └── subscription.tsx
│   ├── lib/                  # Utility & data libraries
│   │   ├── supabase.ts
│   │   ├── collections.ts
│   │   ├── household.ts
│   │   ├── shopping-list.ts
│   │   ├── notifications.ts
│   │   └── ...
│   ├── receipt-review.tsx    # Review scanned receipt items
│   ├── social-recipe-import.tsx
│   └── store-connections.tsx
├── supabase/
│   ├── functions/            # Supabase Edge Functions (Deno)
│   │   ├── goodbot/          # Claude AI chat proxy
│   │   ├── forgot-username/  # Forgot username email
│   │   ├── scan-receipt/     # Receipt OCR + item parsing
│   │   ├── nutrition-lookup/ # Nutrition data enrichment
│   │   ├── recipe-from-url/  # Social recipe scraper
│   │   ├── kroger-oauth/     # Kroger OAuth exchange
│   │   └── kroger-sync/      # Kroger purchase import
│   ├── migrations/           # Postgres migration files
│   └── templates/            # Branded email templates
│       ├── confirmation.html
│       └── recovery.html
├── assets/images/
├── app.json
├── eas.json
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- Supabase CLI: `brew install supabase/tap/supabase`
- Expo Go app (for development) or a dev build

### Environment Variables

Create a `.env` file in the project root:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_ANTHROPIC_API_KEY=your-anthropic-key
EXPO_PUBLIC_REVENUECAT_IOS_KEY=appl_your-ios-public-sdk-key
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_your-android-public-sdk-key
```

> Use the RevenueCat **public SDK keys** (`appl_…` / `goog_…`), not the secret API key. Without these, `Purchases.configure` never runs and the paywall is disabled.

### Install & Run

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go, or press `i` for iOS simulator / `a` for Android.

### Supabase Setup

```bash
# Link to your Supabase project
supabase link --project-ref your-project-ref

# Apply migrations
supabase db push

# Deploy edge functions
supabase functions deploy
```

### Edge Function Secrets

```bash
supabase secrets set ANTHROPIC_API_KEY=your-key
supabase secrets set RESEND_API_KEY=your-resend-key
supabase secrets set RESEND_FROM_EMAIL=noreply@yourdomain.com
supabase secrets set KROGER_CLIENT_ID=your-kroger-id
supabase secrets set KROGER_CLIENT_SECRET=your-kroger-secret
```

---

## Email Templates

GoGood uses branded HTML email templates for all auth flows. Templates are in `supabase/templates/` and must be pasted manually into the Supabase dashboard under **Authentication → Email Templates**.

| Template | Flow |
|---|---|
| `confirmation.html` | Email confirmation on sign up |
| `recovery.html` | Password reset |
| Forgot username | Handled by the `forgot-username` Edge Function + Resend |

**Required Supabase redirect URLs** (Authentication → URL Configuration):

```
gogood://auth/confirm
gogood://auth/reset
```

---

## Subscriptions

Subscriptions are managed via RevenueCat. The app assumes a specific dashboard
configuration — each of the following must match exactly or the paywall falls
back to placeholder prices with a disabled Subscribe button.

**Plans & pricing**

| Plan | Price | Notes |
|---|---|---|
| Free | $0 | 10-item inventory |
| Monthly | $4.99 / mo | |
| Annual | $45.99 / yr | "Save 2 months" vs monthly |

**1. Create store products**

- **App Store Connect** → app (`com.gogood.app`) → Subscriptions → create a
  subscription group with two auto-renewing products:
  - Monthly — e.g. `gogood_premium_monthly`, $4.99
  - Annual — e.g. `gogood_premium_annual`, $45.99. The product ID **must contain
    `annual` or `year`** — the app detects the annual plan by that substring
    (`app/context/subscription.tsx`).
- (Android) Create the equivalent subscriptions in Google Play Console.

**2. Configure RevenueCat** ([app.revenuecat.com](https://app.revenuecat.com))

1. Create a project; add the iOS app (bundle ID `com.gogood.app`) and Android app.
2. **Products** → import both store subscriptions.
3. **Entitlements** → create one with the identifier exactly **`premium`**
   (lowercase) and attach both products.
4. **Offerings** → create an offering and mark it **Current**. Place the monthly
   product in the built-in **Monthly** package slot and the annual product in the
   **Annual** slot (the app finds them by `MONTHLY` / `ANNUAL` package type).

**3. Add keys**

- Copy the **public SDK keys** from RevenueCat → API keys into
  `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (see
  [Environment Variables](#environment-variables)) and your EAS build secrets.

**4. Test**

- Build a real device build (`eas build`) — purchases don't work in Expo Go.
- Use an App Store **Sandbox tester** to confirm real prices load, the Subscribe
  button enables, purchasing flips the user to premium, and Restore Purchases works.

---

## Color Palette (Light Theme)

| Token | Hex | Usage |
|---|---|---|
| `bg` | `#FAF8F3` | Page background |
| `brand` | `#0F7855` | Primary buttons, accents |
| `teal` | `#23B385` | Secondary actions |
| `text` | `#1C1C1E` | Body text |
| `textSub` | `#6B6860` | Secondary text |
| `surface` | `#FFFFFF` | Cards |
| `surfaceAlt` | `#F4F2ED` | Input backgrounds |

---

## Contributing

This is a private project. For questions, contact the maintainer.

---

## License

Private — All rights reserved.
