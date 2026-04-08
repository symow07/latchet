<stack>
  Expo SDK 53, React Native 0.76.7, bun (not npm).
  React Query for server/async state.
  NativeWind + Tailwind v3 for styling.
  react-native-reanimated v3 for animations (preferred over Animated from react-native).
  react-native-gesture-handler for gestures.
  lucide-react-native for icons.
  All packages are pre-installed. DO NOT install new packages unless they are @expo-google-font packages or pure JavaScript helpers like lodash, dayjs, etc.
</stack>

<structure>
  src/app/          — Expo Router file-based routes (src/app/_layout.tsx is root). Add new screens to this folder.
  src/components/   — Reusable UI components. Add new components to this folder.
  src/lib/          — Utilities: cn.ts (className merge), example-context.ts (state pattern)
</structure>

<typescript>
  Explicit type annotations for useState: `useState<Type[]>([])` not `useState([])`
  Null/undefined handling: use optional chaining `?.` and nullish coalescing `??`
  Include ALL required properties when creating objects — TypeScript strict mode is enabled.
</typescript>

<environment>
  You are in Vibecode. The system manages git and the dev server (port 8081).
  DO NOT: manage git, touch the dev server, or check its state.
  The user views the app through Vibecode App.
  The user cannot see the code or interact with the terminal. Do not tell the user to do anything with the code or terminal.
  You can see logs in the expo.log file.
  The Vibecode App has tabs like ENV tab, API tab, LOGS tab. You can ask the user to use these tabs to view the logs, add enviroment variables, or give instructions for APIs like OpenAI, Nanobanana, Grok, Elevenlabs, etc. but first try to implement the functionality yourself.
  The user is likely non-technical, communicate with them in an easy to understand manner.
  If the user's request is vague or ambitious, scope down to specific functionality. Do everything for them.
  For images, use URLs from unsplash.com. You can also tell the user they can use the IMAGES tab to generate and uplooad images.
</environment>


<forbidden_files>
  Do not edit: patches/, babel.config.js, metro.config.js, app.json, tsconfig.json, nativewind-env.d.ts
</forbidden_files>

<routing>
  Expo Router for file-based routing. Every file in src/app/ becomes a route.
  Never delete or refactor RootLayoutNav from src/app/_layout.tsx.
  
  <stack_router>
    src/app/_layout.tsx (root layout), src/app/index.tsx (matches '/'), src/app/settings.tsx (matches '/settings')
    Use <Stack.Screen options={{ title, headerStyle, ... }} /> inside pages to customize headers.
  </stack_router>
  
  <tabs_router>
    Only files registered in src/app/(tabs)/_layout.tsx become actual tabs.
    Unregistered files in (tabs)/ are routes within tabs, not separate tabs.
    Nested stacks create double headers — remove header from tabs, add stack inside each tab.
    At least 2 tabs or don't use tabs at all — single tab looks bad.
  </tabs_router>
  
  <router_selection>
    Games should avoid tabs — use full-screen stacks instead.
    For full-screen overlays/modals outside tabs: create route in src/app/ (not src/app/(tabs)/), 
    then add `<Stack.Screen name="page" options={{ presentation: "modal" }} />` in src/app/_layout.tsx.
  </router_selection>
  
  <rules>
    Only ONE route can map to "/" — can't have both src/app/index.tsx and src/app/(tabs)/index.tsx.
    Dynamic params: use `const { id } = useLocalSearchParams()` from expo-router.
  </rules>
</routing>

<state>
  React Query for server/async state. Always use object API: `useQuery({ queryKey, queryFn })`.
  Never wrap RootLayoutNav directly.
  React Query provider must be outermost; nest other providers inside it.
  
  Use `useMutation` for async operations — no manual `setIsLoading` patterns.
  Wrap third-party lib calls (RevenueCat, etc.) in useQuery/useMutation for consistent loading states.
  Reuse query keys across components to share cached data — don't create duplicate providers.
  
  For local state, use Zustand. However, most state is server state, so use React Query for that.
  Always use a selector with Zustand to subscribe only to the specific slice of state you need (e.g., useStore(s => s.foo)) rather than the whole store to prevent unnecessary re-renders. Make sure that the value returned by the selector is a primitive. Do not execute store methods in selectors; select data/functions, then compute outside the selector.
  For persistence: use AsyncStorage inside context hook providers. Only persist necessary data.
  Split ephemeral from persisted state to avoid hydration bugs.
</state>

<safearea>
  Import from react-native-safe-area-context, NOT from react-native.
  Skip SafeAreaView inside tab stacks with navigation headers.
  Skip when using native headers from Stack/Tab navigator.
  Add when using custom/hidden headers.
  For games: use useSafeAreaInsets hook instead.
</safearea>

<data>
  Create realistic mock data when you lack access to real data.
  For image analysis: actually send to LLM don't mock.
</data>

<design>
  Don't hold back. This is mobile — design for touch, thumb zones, glanceability.
  Inspiration: iOS, Instagram, Airbnb, Coinbase, polished habit trackers.

  <avoid>
    Purple gradients on white, generic centered layouts, predictable patterns.
    Web-like designs on mobile. Overused fonts (Space Grotesk, Inter).
  </avoid>

  <do>
    Cohesive themes with dominant colors and sharp accents.
    High-impact animations: progress bars, button feedback, haptics.
    Depth via gradients and patterns, not flat solids.
    Install `@expo-google-fonts/{font-name}` for fonts (eg: `@expo-google-fonts/inter`)
    Use zeego for context menus and dropdowns (native feel). Lookup the documentation on zeego.dev to see how to use it.
  </do>
</design>

<mistakes>
  <styling>
    Use Nativewind for styling. Use cn() helper from src/lib/cn.ts to merge classNames when conditionally applying classNames or passing classNames via props.
    CameraView, LinearGradient, and Animated components DO NOT support className. Use inline style prop.
    Horizontal ScrollViews will expand vertically to fill flex containers. Add `style={{ flexGrow: 0 }}` to constrain height to content.
  </styling>

  <camera>
    Use CameraView from expo-camera, NOT the deprecated Camera import.
    import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
    Use style={{ flex: 1 }}, not className.
    Overlay UI must be absolute positioned inside CameraView.
  </camera>

  <react_native>
    No Node.js buffer in React Native — don't import from 'buffer'.
  </react_native>

  <ux>
    Use Pressable over TouchableOpacity.
    Use custom modals, not Alert.alert().
    Ensure keyboard is dismissable and doesn't obscure inputs. This is much harder to implement than it seems. You can use the react-native-keyboard-controller package to help with this. But, make sure to look up the documentation before implementing.
  </ux>

  <outdated_knowledge>
    Your react-native-reanimated and react-native-gesture-handler training may be outdated. Look up current docs before implementing.
  </outdated_knowledge>
</mistakes>

<appstore>
  Cannot assist with App Store or Google Play submission processes (app.json, eas.json, EAS CLI commands).
  For submission help, click "Share" on the top right corner on the Vibecode App and select "Submit to App Store".
</appstore> 

<skills>
You have access to a few skills in the `.claude/skills` folder. Use them to your advantage.
- ai-apis-like-chatgpt: Use this skill when the user asks you to make an app that requires an AI API.
- expo-docs: Use this skill when the user asks you to use an Expo SDK module or package that you might not know much about.
- frontend-app-design: Use this skill when the user asks you to design a frontend app component or screen.
</skills>

<real_budget_app>
This is the Real Budget app - a personal finance tracker with:

DATABASE & STATE:
- SQLite database initialized in root _layout.tsx with demo data seeding
- src/lib/db.ts: All CRUD operations for transactions and settings
- src/lib/calculations.ts: All financial calculations and formatting
- React Query caches with refreshKey pattern for refetching on screen focus
- useFocusEffect hook to refetch data when tabs change

TAB STRUCTURE (in src/app/(tabs)/):
- _layout.tsx: Tab navigator with 5 tabs (Dashboard, Add, History, Advisor, Settings)
- index.tsx: Dashboard with metrics, charts, streaks, badges
- add.tsx: Add transaction modal with validation
- transactions.tsx: List with filters (date range, category, impulse toggle)
- advisor.tsx: Redirect to AI Financial Advisor chatbot
- settings.tsx: Budget, balance, hourly rate configuration

BUSINESS MODE (in src/app/(business-tabs)/):
- _layout.tsx: Tab navigator with 6 tabs (Dashboard, Expenses, Team, Subscriptions, Insights, Settings)
- index.tsx: Business dashboard with real expense metrics (total, approved, pending count, recent activity)
- expenses.tsx: Full expense tracking - submit, filter by status, approve/reject with image receipt support
- team.tsx: Team management - invite code display (owner), join-by-code (employee), member list with role management
- Accessed by users who choose "Business" on the account-type screen

EXPENSE TRACKING SYSTEM (Business Mode):
- Backend: /api/expenses (GET, POST), /api/expenses/:id/approve, /api/expenses/:id/reject
- src/lib/expenseApi.ts: All API calls for expenses
- Fields: amount, category (Travel/Software/Meals/Transport/Office/Other), description, imageUrl (optional), status (pending/approved/rejected)
- Status flow: pending → approved/rejected by owner or manager
- Stores: submitterId (who submitted), reviewerId (who approved/rejected)
- Image: local URI from camera or gallery (expo-image-picker)

TEAM INVITE SYSTEM (Business Mode):
- Business model has inviteCode (6-char hex, unique)
- Backend: GET /api/business/invite-code, POST /api/business/invite-code/refresh, POST /api/business/join
- Owner sees invite code on Team tab, can copy or refresh it
- Employees enter the code to join the business as "employee" role
- src/lib/businessApi.ts: All business and team API calls
- Role hierarchy: owner > manager > employee
- Managers can approve/reject expenses; employees can only submit
- GET /api/business now works for all members (not just owner)

AI ADVISOR FEATURE (src/app/advisor.tsx):
- Chatbot interface for financial advice
- Uses OpenAI API (EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY)
- src/lib/ai-analysis.ts: Spending analysis and prompt building
- Analyzes: category spending, overspending detection, spending spikes, projections
- Quick insights shown before chat starts
- Suggested prompts for common questions

CSV IMPORT FEATURE (src/app/import.tsx):
- Upload CSV bank statements
- src/lib/import-parser.ts: CSV parsing, auto-categorization, duplicate detection
- Categories auto-detected from transaction descriptions
- Preview screen allows editing categories before import
- Privacy-focused: files processed locally, never uploaded
- Access via Settings > Import Transactions

SMART ANALYTICS FEATURE (src/app/analytics.tsx):
- Behavior detection dashboard with 4 tabs: Overview, Subscriptions, Insights, Alerts
- src/lib/behavior-detection.ts: All detection algorithms
- Subscription detection: identifies recurring weekly/monthly/yearly charges
- Duplicate charge detection: flags same-day, same-amount transactions
- Unusual transaction detection: highlights purchases 2+ std devs above category average
- Weekend vs weekday spending comparison
- Seasonal/monthly trend analysis
- Top 3 waste categories with personalized savings tips
- Potential savings calculator
- Access via Dashboard > Smart Analytics card

FINANCIAL HEALTH SCORE (src/app/health-score.tsx):
- Dynamic 0-100 score based on 5 factors
- src/lib/health-score.ts: All scoring algorithms
- Breakdown: Savings Rate (25pts), Budget Discipline (25pts), Spending Consistency (20pts), Goal Progress (15pts), Impulse Control (15pts)
- Grade system: A+ to F with color coding
- Weekly trend indicator (up/down/stable)
- Spending personality classification: Saver, Balanced, Spender, Impulsive, Disciplined, Inconsistent
- Personalized improvement suggestions
- Animated circular progress indicator
- Access via Dashboard > Health Score card

BANK LINKING (src/app/link-bank.tsx):
- Optional secure bank connection via OAuth
- src/lib/bank-linking.ts: Connection management
- No password storage - token-based authentication
- Clear consent screen showing data access permissions
- Account toggle to enable/disable sync per account
- Manual disconnect anytime
- Simulated flow (production would use Plaid/Open Banking API)
- Access via Dashboard > Link Bank Account card

ENHANCED AI ADVISOR:
- Now includes health score data in prompts
- Spending personality-aware advice
- 6-month savings forecast
- Category budget optimization suggestions
- Long-term balance projections (6mo, 1yr)
- Savings goal ETA calculation

KEY PATTERNS:
- All expenses are color-coded (red), income (green), impulse (pink badges)
- Discipline grade (A-F) calculated from monthlySpent vs monthlyBudget ratio
- Impulse % = (impulse transactions / total) × 100 over last 30 days
- Survival days = currentBalance / averageDailySpend
- Logging streak = consecutive days with ≥1 transaction
- Badges: unlock for 7-day streak, no impulse day, budget master, no subscriptions
- Time cost displayed when showTimeCost enabled: (amount / hourlyValue) × 60 minutes
- Chart: Simple bar chart of last 14 days with flex layout

STYLING:
- Dark mode only (bg-black, text-white, gray-900 cards)
- All cards use rounded-xl with bg-gray-900
- Buttons use bg-blue-600 for primary actions
- Gradient card for balance display: from-blue-600 to-blue-900
- NativeWind for everything, no special component styling needed

TRANSACTIONS MODEL:
- id: unique string (tx_timestamp_random)
- amount: number
- category: Food|Gym|Transport|Shopping|Subscriptions|Other
- type: Expense|Income
- isImpulse: boolean (1/0 in DB)
- note: optional string
- dateISO: YYYY-MM-DD format
- createdAt: ISO timestamp

SETTINGS MODEL (singleton id=1):
- monthlyBudget: number
- startingBalance: number
- hourlyValue: number ($/hour)
- showTimeCost: boolean (0/1 in DB)

COMMON FIXES:
- Always use refreshKey state + useFocusEffect to refetch after navigation
- Query key structure: ['transactions', refreshKey] for proper invalidation
- When adding/deleting, call queryClient.invalidateQueries + setRefreshKey
- SafeAreaView wrapping scrolls at top level only
- DateTimePicker mode='date' display='spinner' for native picker
- Calculate balance from all txs, not just current month
- Daily chart groups transactions by dateISO (YYYY-MM-DD)
</real_budget_app>