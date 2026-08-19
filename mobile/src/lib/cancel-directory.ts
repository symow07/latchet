export interface CancelDirectoryEntry {
  keywords: string[]; // normalized merchant name keywords to match
  displayName: string;
  cancelUrl: string;
  steps: string[];
  category: string;
  // When the subscription is billed through a platform store, the user must
  // cancel in that store's native subscriptions screen rather than a web page.
  native?: 'apple' | 'google';
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
    native: 'apple',
  },
  {
    keywords: ['google', 'youtube', 'youtube premium', 'google one', 'google play'],
    displayName: 'Google / YouTube',
    cancelUrl: 'https://play.google.com/store/account/subscriptions',
    steps: [
      'Open the Google Play Store app',
      'Tap your profile → Payments & subscriptions → Subscriptions',
      'Select the subscription you want to cancel',
      'Tap "Cancel subscription"',
    ],
    category: 'Google',
    native: 'google',
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

  // ── Business / SaaS ────────────────────────────────────────────────────
  // Merged from the cancel map that lived inside the business subscription
  // detector. The two directories were complementary — consumer services
  // above, work tools here — so both are kept rather than one discarded.
  {
    keywords: ["slack"],
    displayName: "Slack",
    cancelUrl: "https://slack.com/intl/en-gb/admin/billing",
    steps: [
      "slack.com",
      "Workspace Settings",
      "Billing",
      "Cancel plan",
    ],
    category: 'Business software',
  },
  {
    keywords: ["notion"],
    displayName: "Notion",
    cancelUrl: "https://www.notion.so/settings",
    steps: [
      "notion.so/settings",
      "Plans",
      "Downgrade to Free",
    ],
    category: 'Business software',
  },
  {
    keywords: ["figma"],
    displayName: "Figma",
    cancelUrl: "https://www.figma.com/settings",
    steps: [
      "figma.com",
      "Organization Settings",
      "Billing",
      "Downgrade",
    ],
    category: 'Business software',
  },
  {
    keywords: ["github"],
    displayName: "Github",
    cancelUrl: "https://github.com/settings/billing",
    steps: [
      "github.com/settings/billing",
      "Downgrade plan",
    ],
    category: 'Business software',
  },
  {
    keywords: ["zoom"],
    displayName: "Zoom",
    cancelUrl: "https://zoom.us/account/billing",
    steps: [
      "zoom.us",
      "Admin",
      "Account Management",
      "Billing",
      "Cancel",
    ],
    category: 'Business software',
  },
  {
    keywords: ["google workspace", "gsuite", "g suite"],
    displayName: "Google Workspace",
    cancelUrl: "https://admin.google.com",
    steps: [
      "admin.google.com",
      "Billing",
      "Cancel subscription",
    ],
    category: 'Business software',
  },
  {
    keywords: ["microsoft 365", "office 365", "microsoft office"],
    displayName: "Microsoft 365",
    cancelUrl: "https://admin.microsoft.com",
    steps: [
      "admin.microsoft.com",
      "Billing",
      "Your products",
      "Cancel",
    ],
    category: 'Business software',
  },
  {
    keywords: ["aws", "amazon web services"],
    displayName: "Aws",
    cancelUrl: "https://console.aws.amazon.com",
    steps: [
      "AWS Console",
      "Account",
      "Close Account or close individual services",
    ],
    category: 'Business software',
  },
  {
    keywords: ["dropbox"],
    displayName: "Dropbox",
    cancelUrl: "https://www.dropbox.com/account/plan",
    steps: [
      "dropbox.com/account/plan",
      "Change plan",
      "Downgrade to Basic",
    ],
    category: 'Business software',
  },
  {
    keywords: ["hubspot"],
    displayName: "Hubspot",
    cancelUrl: "https://app.hubspot.com/billing",
    steps: [
      "HubSpot",
      "Account Settings",
      "Billing",
      "Cancel subscription",
    ],
    category: 'Business software',
  },
  {
    keywords: ["salesforce"],
    displayName: "Salesforce",
    cancelUrl: "",
    steps: [
      "Contact Salesforce support or your Account Executive to cancel",
    ],
    category: 'Business software',
  },
  {
    keywords: ["asana"],
    displayName: "Asana",
    cancelUrl: "https://app.asana.com/admin",
    steps: [
      "asana.com/admin",
      "Plan & Billing",
      "Cancel Premium",
    ],
    category: 'Business software',
  },
  {
    keywords: ["jira", "atlassian", "confluence", "bitbucket"],
    displayName: "Jira",
    cancelUrl: "https://admin.atlassian.com",
    steps: [
      "admin.atlassian.com",
      "Billing",
      "Cancel subscription",
    ],
    category: 'Business software',
  },
  {
    keywords: ["linear"],
    displayName: "Linear",
    cancelUrl: "https://linear.app/settings/billing",
    steps: [
      "linear.app/settings/billing",
      "Downgrade to Free",
    ],
    category: 'Business software',
  },
  {
    keywords: ["vercel"],
    displayName: "Vercel",
    cancelUrl: "https://vercel.com/account/billing",
    steps: [
      "vercel.com/account/billing",
      "Downgrade to Hobby plan",
    ],
    category: 'Business software',
  },
  {
    keywords: ["netlify"],
    displayName: "Netlify",
    cancelUrl: "https://app.netlify.com",
    steps: [
      "app.netlify.com",
      "Team settings",
      "Billing",
      "Cancel plan",
    ],
    category: 'Business software',
  },
  {
    keywords: ["openai"],
    displayName: "Openai",
    cancelUrl: "https://platform.openai.com/settings",
    steps: [
      "platform.openai.com",
      "Settings",
      "Billing",
      "Cancel plan",
    ],
    category: 'Business software',
  },
  {
    keywords: ["intercom"],
    displayName: "Intercom",
    cancelUrl: "https://app.intercom.com",
    steps: [
      "app.intercom.com",
      "Settings",
      "Subscription",
      "Cancel",
    ],
    category: 'Business software',
  },
  {
    keywords: ["zendesk"],
    displayName: "Zendesk",
    cancelUrl: "https://support.zendesk.com",
    steps: [
      "Admin Center",
      "Subscription",
      "Cancel subscription",
    ],
    category: 'Business software',
  },
  {
    keywords: ["airtable"],
    displayName: "Airtable",
    cancelUrl: "https://airtable.com/account",
    steps: [
      "airtable.com/account",
      "Plan",
      "Downgrade to Free",
    ],
    category: 'Business software',
  },
  {
    keywords: ["zapier"],
    displayName: "Zapier",
    cancelUrl: "https://zapier.com/app/settings/billing",
    steps: [
      "zapier.com/app/settings/billing",
      "Downgrade plan",
    ],
    category: 'Business software',
  },
  {
    keywords: ["adobe", "creative cloud"],
    displayName: "Adobe",
    cancelUrl: "https://account.adobe.com/plans",
    steps: [
      "account.adobe.com",
      "Plans",
      "Manage plan",
      "Cancel plan",
    ],
    category: 'Business software',
  },
  {
    keywords: ["loom"],
    displayName: "Loom",
    cancelUrl: "https://www.loom.com/settings/account",
    steps: [
      "loom.com/settings/account",
      "Plans",
      "Downgrade",
    ],
    category: 'Business software',
  },
  {
    keywords: ["miro"],
    displayName: "Miro",
    cancelUrl: "https://miro.com/app/dashboard",
    steps: [
      "miro.com",
      "Team profile",
      "Plans & billing",
      "Downgrade",
    ],
    category: 'Business software',
  },
  {
    keywords: ["monday"],
    displayName: "Monday",
    cancelUrl: "https://monday.com",
    steps: [
      "monday.com",
      "Admin",
      "Billing",
      "Cancel",
    ],
    category: 'Business software',
  },
  {
    keywords: ["clickup"],
    displayName: "Clickup",
    cancelUrl: "https://app.clickup.com",
    steps: [
      "clickup.com",
      "Workspace Settings",
      "Plans",
      "Downgrade",
    ],
    category: 'Business software',
  },
  {
    keywords: ["trello"],
    displayName: "Trello",
    cancelUrl: "https://trello.com/billing",
    steps: [
      "trello.com/billing",
      "Cancel plan",
    ],
    category: 'Business software',
  },
  {
    keywords: ["stripe"],
    displayName: "Stripe",
    cancelUrl: "",
    steps: [
      "Contact the service provider directly to cancel your subscription",
    ],
    category: 'Business software',
  },
  {
    keywords: ["typeform"],
    displayName: "Typeform",
    cancelUrl: "https://admin.typeform.com",
    steps: [
      "typeform.com",
      "Account",
      "Plan",
      "Cancel plan",
    ],
    category: 'Business software',
  },
  {
    keywords: ["hotjar"],
    displayName: "Hotjar",
    cancelUrl: "https://insights.hotjar.com/account/subscription",
    steps: [
      "hotjar.com",
      "Account",
      "Plan",
      "Downgrade",
    ],
    category: 'Business software',
  },
  {
    keywords: ["mixpanel"],
    displayName: "Mixpanel",
    cancelUrl: "https://mixpanel.com/settings",
    steps: [
      "mixpanel.com",
      "Organization Settings",
      "Plan",
      "Downgrade",
    ],
    category: 'Business software',
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

// Native subscription-management deep links. `itms-apps://` jumps straight to
// the iOS Settings → Subscriptions screen (the only place Apple-billed
// subscriptions can be canceled).
const APPLE_SUBSCRIPTIONS_DEEP_LINK = 'itms-apps://apps.apple.com/account/subscriptions';
const GOOGLE_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';

/**
 * Resolve the best one-tap cancel destination for an entry. For store-billed
 * subscriptions this is the native subscriptions screen; otherwise it's the
 * merchant's exact web cancel page.
 */
export function getCancelLink(entry: CancelDirectoryEntry): { url: string; label: string } {
  if (entry.native === 'apple') {
    return { url: APPLE_SUBSCRIPTIONS_DEEP_LINK, label: 'Cancel in Settings' };
  }
  if (entry.native === 'google') {
    return { url: GOOGLE_SUBSCRIPTIONS_URL, label: 'Cancel in Google Play' };
  }
  return { url: entry.cancelUrl, label: `Cancel ${entry.displayName}` };
}
