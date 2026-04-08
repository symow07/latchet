export interface CancelDirectoryEntry {
  keywords: string[]; // normalized merchant name keywords to match
  displayName: string;
  cancelUrl: string;
  steps: string[];
  category: string;
}

export const CANCEL_DIRECTORY: CancelDirectoryEntry[] = [
  {
    keywords: ['netflix'],
    displayName: 'Netflix',
    cancelUrl: 'https://www.netflix.com/cancelplan',
    steps: [
      'Go to netflix.com and sign in',
      'Tap your profile icon → Account',
      'Scroll to "Membership & Billing"',
      'Tap "Cancel Membership"',
      'Confirm cancellation',
    ],
    category: 'Streaming',
  },
  {
    keywords: ['spotify'],
    displayName: 'Spotify',
    cancelUrl: 'https://www.spotify.com/account/subscription/cancel',
    steps: [
      'Go to spotify.com/account and sign in',
      'Under "Your plan", tap "Change plan"',
      'Scroll to the bottom and tap "Cancel Premium"',
      'Follow the prompts to confirm',
    ],
    category: 'Music',
  },
  {
    keywords: ['apple', 'itunes', 'icloud', 'apple one', 'apple tv', 'apple music', 'apple arcade'],
    displayName: 'Apple',
    cancelUrl: 'https://apps.apple.com/account/subscriptions',
    steps: [
      'Open Settings on your iPhone',
      'Tap your name → Subscriptions',
      'Find the subscription you want to cancel',
      'Tap "Cancel Subscription"',
    ],
    category: 'Apple',
  },
  {
    keywords: ['google', 'youtube', 'youtube premium', 'google one', 'google play'],
    displayName: 'Google / YouTube',
    cancelUrl: 'https://myaccount.google.com/payments-and-subscriptions',
    steps: [
      'Go to myaccount.google.com',
      'Tap "Payments & subscriptions"',
      'Tap "Manage subscriptions"',
      'Find the subscription and tap "Cancel"',
    ],
    category: 'Google',
  },
  {
    keywords: ['amazon', 'amazon prime', 'prime video', 'audible', 'kindle unlimited'],
    displayName: 'Amazon / Prime',
    cancelUrl: 'https://www.amazon.com/mc/pipelines/cancellation',
    steps: [
      'Go to amazon.com and sign in',
      'Account & Lists → Prime Membership',
      'Tap "Update, cancel and more"',
      'Tap "End Membership"',
    ],
    category: 'Shopping',
  },
  {
    keywords: ['adobe', 'creative cloud', 'photoshop', 'illustrator', 'premiere'],
    displayName: 'Adobe',
    cancelUrl: 'https://account.adobe.com/plans',
    steps: [
      'Go to account.adobe.com/plans',
      'Find your plan and tap "Manage plan"',
      'Tap "Cancel plan"',
      'Follow the prompts (early termination fee may apply)',
    ],
    category: 'Software',
  },
  {
    keywords: ['hulu'],
    displayName: 'Hulu',
    cancelUrl: 'https://secure.hulu.com/account/cancel',
    steps: [
      'Go to hulu.com/account and sign in',
      'Scroll to "Your Subscription"',
      'Tap "Cancel"',
      'Select a reason and confirm',
    ],
    category: 'Streaming',
  },
  {
    keywords: ['disney', 'disney plus', 'disneyplus'],
    displayName: 'Disney+',
    cancelUrl: 'https://www.disneyplus.com/account',
    steps: [
      'Go to disneyplus.com and sign in',
      'Tap your profile → Account',
      'Under your subscription, tap "Cancel subscription"',
      'Confirm cancellation',
    ],
    category: 'Streaming',
  },
  {
    keywords: ['hbo', 'max', 'hbo max'],
    displayName: 'Max (HBO)',
    cancelUrl: 'https://www.max.com/settings/subscription',
    steps: [
      'Go to max.com and sign in',
      'Settings → Subscription',
      'Tap "Cancel Subscription"',
      'Confirm cancellation',
    ],
    category: 'Streaming',
  },
  {
    keywords: ['microsoft', 'office', 'office 365', 'microsoft 365', 'xbox', 'xbox game pass'],
    displayName: 'Microsoft',
    cancelUrl: 'https://account.microsoft.com/services',
    steps: [
      'Go to account.microsoft.com/services',
      'Find your subscription',
      'Tap "Cancel" or "Turn off recurring billing"',
    ],
    category: 'Software',
  },
  {
    keywords: ['dropbox'],
    displayName: 'Dropbox',
    cancelUrl: 'https://www.dropbox.com/account/plan',
    steps: [
      'Go to dropbox.com and sign in',
      'Account settings → Plan',
      'Tap "Cancel plan"',
      'Follow the prompts',
    ],
    category: 'Cloud Storage',
  },
  {
    keywords: ['patreon'],
    displayName: 'Patreon',
    cancelUrl: 'https://www.patreon.com/settings/memberships',
    steps: [
      'Go to patreon.com and sign in',
      'Your profile → Memberships',
      'Find the membership and tap "Edit"',
      'Tap "Cancel membership"',
    ],
    category: 'Subscriptions',
  },
  {
    keywords: ['twitch'],
    displayName: 'Twitch',
    cancelUrl: 'https://www.twitch.tv/subscriptions',
    steps: [
      'Go to twitch.tv and sign in',
      'Your username → Subscriptions',
      'Find subscription and tap "Cancel"',
    ],
    category: 'Gaming',
  },
  {
    keywords: ['playstation', 'ps plus', 'psplus', 'playstation plus'],
    displayName: 'PlayStation Plus',
    cancelUrl: 'https://www.playstation.com/en-us/playstation-plus/',
    steps: [
      'Go to PlayStation settings on console or web',
      'Account Management → Subscriptions',
      'Select PlayStation Plus',
      'Tap "Cancel Subscription"',
    ],
    category: 'Gaming',
  },
  {
    keywords: ['duolingo', 'duolingo plus', 'duolingo super'],
    displayName: 'Duolingo',
    cancelUrl: 'https://www.duolingo.com/settings/super',
    steps: [
      'Go to duolingo.com and sign in',
      'Settings → Super Duolingo',
      'Tap "Cancel Subscription"',
    ],
    category: 'Education',
  },
  {
    keywords: ['chatgpt', 'openai', 'openai chatgpt'],
    displayName: 'ChatGPT Plus',
    cancelUrl: 'https://chat.openai.com/#settings/subscription',
    steps: [
      'Go to chat.openai.com and sign in',
      'Tap your profile → Settings',
      'Under Subscription, tap "Manage"',
      'Tap "Cancel Plan"',
    ],
    category: 'AI',
  },
  {
    keywords: ['notion'],
    displayName: 'Notion',
    cancelUrl: 'https://www.notion.so/my-account',
    steps: [
      'Go to notion.so and sign in',
      'Settings & Members → Plans',
      'Tap "Downgrade" or "Cancel plan"',
    ],
    category: 'Productivity',
  },
  {
    keywords: ['slack'],
    displayName: 'Slack',
    cancelUrl: 'https://slack.com/intl/en-us/help/articles/203124568',
    steps: [
      'Go to your Slack workspace settings',
      'Billing → Subscription',
      'Tap "Cancel subscription"',
    ],
    category: 'Productivity',
  },
  {
    keywords: ['zoom'],
    displayName: 'Zoom',
    cancelUrl: 'https://zoom.us/billing',
    steps: [
      'Go to zoom.us and sign in',
      'Account Management → Billing',
      'Current Plans → Cancel Plan',
    ],
    category: 'Productivity',
  },
  {
    keywords: ['canva', 'canva pro'],
    displayName: 'Canva Pro',
    cancelUrl: 'https://www.canva.com/settings/billing',
    steps: [
      'Go to canva.com and sign in',
      'Account Settings → Billing & Plans',
      'Tap "Cancel Plan"',
      'Follow the prompts',
    ],
    category: 'Design',
  },
];

export function findCancelEntry(normalizedMerchant: string): CancelDirectoryEntry | null {
  const lower = normalizedMerchant.toLowerCase();
  return (
    CANCEL_DIRECTORY.find(entry =>
      entry.keywords.some(kw => lower.includes(kw) || kw.includes(lower))
    ) ?? null
  );
}
