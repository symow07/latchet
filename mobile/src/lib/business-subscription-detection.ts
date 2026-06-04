import { type Expense } from './expenseApi';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DetectedSubscription {
  key: string;
  name: string;
  amount: number;
  category: string;
  lastChargeDate: string;
  nextChargeDate: string;
  isRecurring: boolean;
  monthlyCount: number;
  cancelInstructions: string;
  cancelUrl?: string;
}

export interface SubscriptionSummary {
  monthlyTotal: number;
  annualTotal: number;
  subscriptions: DetectedSubscription[];
  upcoming: DetectedSubscription[];
}

// ─── Cancel Instructions ───────────────────────────────────────────────────────

const CANCEL_MAP: { keywords: string[]; instructions: string; url?: string }[] = [
  { keywords: ['slack'],            instructions: 'slack.com → Workspace Settings → Billing → Cancel plan',         url: 'https://slack.com/intl/en-gb/admin/billing' },
  { keywords: ['notion'],           instructions: 'notion.so/settings → Plans → Downgrade to Free',                  url: 'https://www.notion.so/settings' },
  { keywords: ['figma'],            instructions: 'figma.com → Organization Settings → Billing → Downgrade',        url: 'https://www.figma.com/settings' },
  { keywords: ['github'],           instructions: 'github.com/settings/billing → Downgrade plan',                   url: 'https://github.com/settings/billing' },
  { keywords: ['zoom'],             instructions: 'zoom.us → Admin → Account Management → Billing → Cancel',        url: 'https://zoom.us/account/billing' },
  { keywords: ['google workspace', 'gsuite', 'g suite'], instructions: 'admin.google.com → Billing → Cancel subscription', url: 'https://admin.google.com' },
  { keywords: ['microsoft 365', 'office 365', 'microsoft office'], instructions: 'admin.microsoft.com → Billing → Your products → Cancel', url: 'https://admin.microsoft.com' },
  { keywords: ['aws', 'amazon web services'], instructions: 'AWS Console → Account → Close Account or close individual services', url: 'https://console.aws.amazon.com' },
  { keywords: ['dropbox'],          instructions: 'dropbox.com/account/plan → Change plan → Downgrade to Basic', url: 'https://www.dropbox.com/account/plan' },
  { keywords: ['hubspot'],          instructions: 'HubSpot → Account Settings → Billing → Cancel subscription',     url: 'https://app.hubspot.com/billing' },
  { keywords: ['salesforce'],       instructions: 'Contact Salesforce support or your Account Executive to cancel' },
  { keywords: ['asana'],            instructions: 'asana.com/admin → Plan & Billing → Cancel Premium',              url: 'https://app.asana.com/admin' },
  { keywords: ['jira', 'atlassian', 'confluence', 'bitbucket'], instructions: 'admin.atlassian.com → Billing → Cancel subscription', url: 'https://admin.atlassian.com' },
  { keywords: ['linear'],           instructions: 'linear.app/settings/billing → Downgrade to Free',                url: 'https://linear.app/settings/billing' },
  { keywords: ['vercel'],           instructions: 'vercel.com/account/billing → Downgrade to Hobby plan',           url: 'https://vercel.com/account/billing' },
  { keywords: ['netlify'],          instructions: 'app.netlify.com → Team settings → Billing → Cancel plan',       url: 'https://app.netlify.com' },
  { keywords: ['openai'],           instructions: 'platform.openai.com → Settings → Billing → Cancel plan',        url: 'https://platform.openai.com/settings' },
  { keywords: ['intercom'],         instructions: 'app.intercom.com → Settings → Subscription → Cancel',           url: 'https://app.intercom.com' },
  { keywords: ['zendesk'],          instructions: 'Admin Center → Subscription → Cancel subscription',              url: 'https://support.zendesk.com' },
  { keywords: ['airtable'],         instructions: 'airtable.com/account → Plan → Downgrade to Free',               url: 'https://airtable.com/account' },
  { keywords: ['zapier'],           instructions: 'zapier.com/app/settings/billing → Downgrade plan',              url: 'https://zapier.com/app/settings/billing' },
  { keywords: ['adobe', 'creative cloud'], instructions: 'account.adobe.com → Plans → Manage plan → Cancel plan', url: 'https://account.adobe.com/plans' },
  { keywords: ['loom'],             instructions: 'loom.com/settings/account → Plans → Downgrade',                 url: 'https://www.loom.com/settings/account' },
  { keywords: ['miro'],             instructions: 'miro.com → Team profile → Plans & billing → Downgrade',         url: 'https://miro.com/app/dashboard' },
  { keywords: ['monday'],           instructions: 'monday.com → Admin → Billing → Cancel',                         url: 'https://monday.com' },
  { keywords: ['clickup'],          instructions: 'clickup.com → Workspace Settings → Plans → Downgrade',          url: 'https://app.clickup.com' },
  { keywords: ['trello'],           instructions: 'trello.com/billing → Cancel plan',                              url: 'https://trello.com/billing' },
  { keywords: ['stripe'],           instructions: 'Contact the service provider directly to cancel your subscription' },
  { keywords: ['typeform'],         instructions: 'typeform.com → Account → Plan → Cancel plan',                   url: 'https://admin.typeform.com' },
  { keywords: ['hotjar'],           instructions: 'hotjar.com → Account → Plan → Downgrade',                      url: 'https://insights.hotjar.com/account/subscription' },
  { keywords: ['mixpanel'],         instructions: 'mixpanel.com → Organization Settings → Plan → Downgrade',       url: 'https://mixpanel.com/settings' },
];

function getCancelInfo(name: string): { instructions: string; url?: string } {
  const lower = name.toLowerCase();
  for (const entry of CANCEL_MAP) {
    if (entry.keywords.some(k => lower.includes(k))) {
      return { instructions: entry.instructions, url: entry.url };
    }
  }
  return {
    instructions: 'Visit the service\'s account or billing settings page and select "Cancel", "Downgrade", or "End subscription".',
  };
}

// ─── Detection Logic ────────────────────────────────────────────────────────────

function normalizeKey(desc: string): string {
  return desc.toLowerCase().trim().replace(/\s+/g, ' ');
}

function monthKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function detectSubscriptions(expenses: Expense[]): SubscriptionSummary {
  // Only consider approved expenses for reliable detection
  const approved = expenses.filter(e => e.status === 'approved');

  // Group by normalized description
  const groups: Record<string, Expense[]> = {};
  for (const exp of approved) {
    const key = normalizeKey(exp.description);
    if (!groups[key]) groups[key] = [];
    groups[key].push(exp);
  }

  const today = new Date();
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);

  const subscriptions: DetectedSubscription[] = [];

  for (const [key, exps] of Object.entries(groups)) {
    const isSoftware = exps.some(e => e.category === 'Software');

    // Get distinct months
    const months = new Set(exps.map(e => monthKey(e.submittedAt)));
    const isRecurring = months.size >= 2;

    // Include if: recurring in 2+ months OR is a Software expense
    if (!isRecurring && !isSoftware) continue;

    // Most recent charge
    const sorted = [...exps].sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
    const latest = sorted[0];

    // Average monthly amount (sum within same month, then average across months)
    const byMonth: Record<string, number> = {};
    for (const e of exps) {
      const mk = monthKey(e.submittedAt);
      byMonth[mk] = (byMonth[mk] ?? 0) + e.amount;
    }
    const monthlyAmounts = Object.values(byMonth);
    const avgMonthly = monthlyAmounts.reduce((s, v) => s + v, 0) / monthlyAmounts.length;

    // Project next charge ~30 days from last
    const nextChargeDate = addDays(latest.submittedAt, 30);

    const { instructions, url } = getCancelInfo(latest.description);

    subscriptions.push({
      key,
      name: latest.description,
      amount: avgMonthly,
      category: latest.category,
      lastChargeDate: latest.submittedAt,
      nextChargeDate,
      isRecurring,
      monthlyCount: months.size,
      cancelInstructions: instructions,
      cancelUrl: url,
    });
  }

  // Sort by amount descending
  subscriptions.sort((a, b) => b.amount - a.amount);

  const monthlyTotal = subscriptions.reduce((s, sub) => s + sub.amount, 0);
  const annualTotal = monthlyTotal * 12;

  // Upcoming: next charge within 30 days
  const upcoming = subscriptions.filter(s => {
    const next = new Date(s.nextChargeDate);
    return next >= today && next <= in30Days;
  });

  return { monthlyTotal, annualTotal, subscriptions, upcoming };
}

// ─── Format helpers ─────────────────────────────────────────────────────────────

export function formatNextCharge(dateStr: string): string {
  const next = new Date(dateStr);
  const today = new Date();
  const diffDays = Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'Overdue';
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays <= 7) return `In ${diffDays} days`;
  return next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
