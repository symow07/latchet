/**
 * Guided cancellation (C19): where a subscription is cancelled, and how.
 *
 * Budget cannot cancel anything itself, and never says it can. What it can do
 * is send the user to the exact place where cancelling happens, with short
 * steps in their language, and then ask them to confirm they did it.
 *
 * Where that place is depends first on who bills the subscription, not on who
 * provides it:
 *   apple        the App Store's subscriptions (on iOS the system screen, from
 *                anywhere else Apple's own guide) — a Netflix bought inside
 *                the iPhone app can only be cancelled there;
 *   google_play  Google Play's subscriptions, opened on the app's own entry
 *                when its package is known;
 *   paypal       PayPal's automatic payments, plus the service's own page:
 *                stopping PayPal does not close the account;
 *   otherwise    the service's own cancellation or account page, keyed by the
 *                canonical merchant key (lib/subscriptions merchantKey), with
 *                steps built from a small vocabulary of places and buttons so
 *                every service reads naturally in all four languages;
 *                phone, internet and TV contracts, and gyms, get the guide for
 *                contracts; anything unknown a generic guide (the merchant's
 *                account page, the app stores, the bank).
 *
 * Pure: no React Native. The platform comes in as an argument; translations
 * are resolved when a guide is built, never at import (i18n.test.ts).
 */
import { getLocale, t } from './i18n/core';
import { aliasFor, merchantKey } from './subscriptions/merchant';
import type { BilledVia } from './subscriptions/types';

// ── The vocabulary steps are built from ──────────────────────────────────────

/** A menu or page on the service's site, in the user's language (subsUi.guide.place.*). */
export type CancelPlace =
  | 'account'
  | 'profile'
  | 'settings'
  | 'billing'
  | 'plan'
  | 'plans'
  | 'membership'
  | 'subscription'
  | 'subscriptions'
  | 'payments'
  | 'services'
  | 'admin'
  | 'workspaceSettings'
  | 'me'
  | 'memberCenter'
  | 'autoRenew';

/** The button that ends it (subsUi.guide.action.*). */
export type CancelAction =
  | 'cancelMembership'
  | 'cancelSubscription'
  | 'cancelPlan'
  | 'endMembership'
  | 'finishCancel'
  | 'downgradeFree'
  | 'turnOffRenew'
  | 'closeAccount';

/** One service Budget knows how to send the user to. */
export interface CancelService {
  /** The canonical merchant key (merchantKey), or for a tool the alias table lacks, its natural key. */
  key: string;
  name: string;
  /** The page to open: the cancellation page itself, or the account page it lives on. Empty: none to open. */
  url: string;
  /** What `url` is: `cancel` the cancellation page, `account` the account it is in, `app` none (steps in the app). */
  open: 'cancel' | 'account' | 'app';
  /** Where to go from there, in order. */
  path: readonly CancelPlace[];
  action: CancelAction;
  category: string;
  /** More spellings to recognise it by (older keys, product names). */
  keywords?: readonly string[];
  /** Its Android package: Google Play opens the app's own subscription entry. */
  android?: string;
  /** Apple's own services: Apple bills them, so they are cancelled in Apple's subscriptions. */
  store?: 'apple';
  /** Usually bought inside the phone app: then the store bills it. */
  inApp?: boolean;
  /** Usually paid by an automatic Alipay or WeChat Pay deduction. */
  autoDebit?: boolean;
}

const svc = (
  key: string,
  name: string,
  url: string,
  open: CancelService['open'],
  path: readonly CancelPlace[],
  action: CancelAction,
  category: string,
  extra: Partial<Pick<CancelService, 'keywords' | 'android' | 'store' | 'inApp' | 'autoDebit'>> = {},
): CancelService => ({ key, name, url, open, path, action, category, ...extra });

/** Apple's own subscriptions: always billed by Apple. */
const apple = (key: string, name: string, keywords: string[] = []): CancelService =>
  svc(key, name, '', 'app', [], 'cancelSubscription', 'Apple', { store: 'apple', keywords });

/** A Chinese membership: renewed by the app's own auto-renewal, usually paid by Alipay or WeChat Pay. */
const cn = (key: string, name: string, category: string, keywords: string[] = []): CancelService =>
  svc(key, name, '', 'app', ['me', 'memberCenter', 'autoRenew'], 'turnOffRenew', category, { autoDebit: true, keywords });

export const CANCEL_SERVICES: readonly CancelService[] = [
  // ── Video ──
  svc('netflix', 'Netflix', 'https://www.netflix.com/cancelplan', 'cancel', [], 'finishCancel', 'Streaming', { android: 'com.netflix.mediaclient' }),
  svc('hulu', 'Hulu', 'https://secure.hulu.com/account', 'account', ['subscription'], 'cancelSubscription', 'Streaming', { android: 'com.hulu.plus' }),
  svc('disney_plus', 'Disney+', 'https://www.disneyplus.com/account', 'account', ['subscription'], 'cancelSubscription', 'Streaming', { keywords: ['disney plus', 'disneyplus'], android: 'com.disney.disneyplus' }),
  svc('hbo_max', 'HBO Max', 'https://www.max.com/settings/subscription', 'account', [], 'cancelSubscription', 'Streaming', { keywords: ['hbo max', 'hbomax'], android: 'com.wbd.stream' }),
  svc('paramount_plus', 'Paramount+', 'https://www.paramountplus.com/account/', 'account', [], 'cancelSubscription', 'Streaming', { android: 'com.cbs.app' }),
  svc('peacock', 'Peacock', 'https://www.peacocktv.com/account/plans', 'account', [], 'cancelPlan', 'Streaming'),
  svc('youtube_premium', 'YouTube Premium', 'https://www.youtube.com/paid_memberships', 'account', [], 'cancelMembership', 'Streaming', { keywords: ['youtube premium'], android: 'com.google.android.youtube' }),
  svc('youtube_music', 'YouTube Music', 'https://www.youtube.com/paid_memberships', 'account', [], 'cancelMembership', 'Music', { android: 'com.google.android.apps.youtube.music' }),
  svc('youtube_tv', 'YouTube TV', 'https://tv.youtube.com/settings/membership', 'account', [], 'cancelMembership', 'Streaming'),
  svc('crunchyroll', 'Crunchyroll', 'https://www.crunchyroll.com/account/membership', 'account', [], 'cancelMembership', 'Streaming', { android: 'com.crunchyroll.crunchyroid' }),
  svc('dazn', 'DAZN', 'https://www.dazn.com/myaccount', 'account', ['subscription'], 'cancelSubscription', 'Streaming'),
  svc('canal_plus', 'Canal+', 'https://client.canalplus.com/', 'account', ['subscription'], 'cancelSubscription', 'Streaming', { keywords: ['canal plus', 'canalplus', 'mycanal'] }),
  svc('twitch', 'Twitch', 'https://www.twitch.tv/subscriptions', 'account', [], 'turnOffRenew', 'Gaming', { android: 'tv.twitch.android.app' }),
  cn('iqiyi', '爱奇艺', 'Streaming', ['iqiyi']),
  cn('tencent_video', '腾讯视频', 'Streaming', ['tencent video']),
  cn('youku', '优酷', 'Streaming', ['youku']),
  cn('bilibili', '哔哩哔哩', 'Streaming', ['bilibili']),
  cn('mango_tv', '芒果TV', 'Streaming', ['mango tv']),

  // ── Music, audio, reading ──
  svc('spotify', 'Spotify', 'https://www.spotify.com/account/subscription/', 'account', [], 'cancelSubscription', 'Music', { android: 'com.spotify.music' }),
  svc('deezer', 'Deezer', 'https://www.deezer.com/account/subscription', 'account', [], 'cancelSubscription', 'Music', { android: 'deezer.android.app' }),
  svc('tidal', 'Tidal', 'https://account.tidal.com/subscription', 'account', [], 'cancelSubscription', 'Music'),
  svc('amazon_music', 'Amazon Music', 'https://www.amazon.com/music/settings', 'account', [], 'cancelSubscription', 'Music'),
  svc('siriusxm', 'SiriusXM', 'https://care.siriusxm.com/', 'account', ['subscriptions'], 'cancelSubscription', 'Music'),
  svc('audible', 'Audible', 'https://www.audible.com/account/overview', 'account', ['membership'], 'cancelMembership', 'Books', { android: 'com.audible.application' }),
  svc('kindle_unlimited', 'Kindle Unlimited', 'https://www.amazon.com/kindle-dbs/ku/ku-central', 'account', [], 'cancelMembership', 'Books'),
  cn('netease_music', '网易云音乐', 'Music', ['netease music', 'netease cloud music']),
  cn('qq_music', 'QQ音乐', 'Music', ['qq music']),
  cn('kugou', '酷狗音乐', 'Music', ['kugou']),
  cn('ximalaya', '喜马拉雅', 'Books', ['ximalaya']),

  // ── News and creators ──
  svc('nyt', 'The New York Times', 'https://myaccount.nytimes.com/seg/subscription', 'account', [], 'cancelSubscription', 'News', { keywords: ['new york times', 'nytimes'] }),
  svc('wsj', 'The Wall Street Journal', 'https://customercenter.wsj.com/', 'account', ['subscriptions'], 'cancelSubscription', 'News', { keywords: ['wall street journal'] }),
  svc('the_guardian', 'The Guardian', 'https://manage.theguardian.com/', 'account', [], 'cancelSubscription', 'News', { keywords: ['guardian'] }),
  svc('le_monde', 'Le Monde', 'https://moncompte.lemonde.fr/', 'account', ['subscription'], 'cancelSubscription', 'News', { keywords: ['le monde', 'lemonde'] }),
  svc('medium', 'Medium', 'https://medium.com/me/settings/membership', 'account', [], 'cancelMembership', 'News', { android: 'com.medium.reader' }),
  svc('patreon', 'Patreon', 'https://www.patreon.com/settings/memberships', 'account', [], 'cancelMembership', 'Subscriptions'),

  // ── Apple's own ──
  apple('apple_music', 'Apple Music'),
  apple('apple_tv', 'Apple TV+', ['apple tv']),
  apple('icloud', 'iCloud+', ['icloud']),
  apple('apple_one', 'Apple One'),
  apple('apple_arcade', 'Apple Arcade'),
  apple('apple_news', 'Apple News+'),

  // ── Storage, software, AI ──
  svc('google_one', 'Google One', 'https://one.google.com/settings', 'account', [], 'cancelMembership', 'Cloud Storage', { android: 'com.google.android.apps.subscriptions.red' }),
  svc('google_workspace', 'Google Workspace', 'https://admin.google.com/ac/billing/subscriptions', 'account', ['billing', 'subscriptions'], 'cancelSubscription', 'Business software', { keywords: ['google workspace', 'gsuite', 'g suite'] }),
  svc('dropbox', 'Dropbox', 'https://www.dropbox.com/account/plan', 'account', [], 'cancelPlan', 'Cloud Storage', { android: 'com.dropbox.android' }),
  svc('microsoft_365', 'Microsoft 365', 'https://account.microsoft.com/services', 'account', ['services'], 'cancelSubscription', 'Software', { keywords: ['microsoft 365', 'office 365', 'microsoft office'] }),
  svc('xbox_game_pass', 'Xbox Game Pass', 'https://account.microsoft.com/services', 'account', ['services'], 'cancelSubscription', 'Gaming', { keywords: ['xbox', 'game pass'] }),
  svc('playstation_plus', 'PlayStation Plus', 'https://store.playstation.com/', 'account', ['subscriptions'], 'turnOffRenew', 'Gaming', { keywords: ['playstation', 'ps plus', 'psplus'] }),
  svc('adobe', 'Adobe', 'https://account.adobe.com/plans', 'account', ['plans'], 'cancelPlan', 'Software', { keywords: ['creative cloud', 'photoshop', 'illustrator', 'premiere', 'acrobat'] }),
  svc('canva', 'Canva', 'https://www.canva.com/settings/billing', 'account', [], 'cancelSubscription', 'Design', { keywords: ['canva pro'], android: 'com.canva.editor' }),
  svc('notion', 'Notion', 'https://www.notion.so/', 'account', ['settings', 'plans'], 'downgradeFree', 'Productivity'),
  svc('slack', 'Slack', 'https://slack.com/admin/billing', 'account', [], 'downgradeFree', 'Business software'),
  svc('zoom', 'Zoom', 'https://zoom.us/billing', 'account', [], 'cancelSubscription', 'Productivity'),
  svc('github', 'GitHub', 'https://github.com/settings/billing', 'account', [], 'downgradeFree', 'Business software'),
  svc('figma', 'Figma', 'https://www.figma.com/settings', 'account', ['billing'], 'cancelPlan', 'Business software'),
  svc('linear', 'Linear', 'https://linear.app/settings/billing', 'account', [], 'downgradeFree', 'Business software'),
  svc('chatgpt', 'ChatGPT', 'https://chatgpt.com/', 'account', ['settings', 'subscription'], 'cancelPlan', 'AI', { keywords: ['openai', 'chatgpt plus'], inApp: true, android: 'com.openai.chatgpt' }),
  svc('claude', 'Claude', 'https://claude.ai/settings/billing', 'account', [], 'cancelPlan', 'AI', { keywords: ['anthropic'], inApp: true }),
  svc('midjourney', 'Midjourney', 'https://www.midjourney.com/account', 'account', [], 'cancelPlan', 'AI'),
  svc('perplexity', 'Perplexity', 'https://www.perplexity.ai/settings/account', 'account', ['subscription'], 'cancelSubscription', 'AI', { inApp: true }),
  svc('cursor', 'Cursor', 'https://cursor.com/settings', 'account', [], 'cancelSubscription', 'AI'),
  svc('grammarly', 'Grammarly', 'https://account.grammarly.com/subscription', 'account', [], 'cancelSubscription', 'Productivity'),
  svc('duolingo', 'Duolingo', 'https://www.duolingo.com/settings/super', 'account', [], 'cancelSubscription', 'Education', { inApp: true, android: 'com.duolingo' }),
  svc('headspace', 'Headspace', 'https://www.headspace.com/account', 'account', ['subscription'], 'cancelSubscription', 'Health', { inApp: true, android: 'com.getsomeheadspace.android' }),
  svc('calm', 'Calm', 'https://www.calm.com/account', 'account', ['subscription'], 'turnOffRenew', 'Health', { inApp: true, android: 'com.calm.android' }),
  svc('strava', 'Strava', 'https://www.strava.com/account', 'account', [], 'cancelSubscription', 'Health', { inApp: true, android: 'com.strava' }),
  svc('nordvpn', 'NordVPN', 'https://my.nordaccount.com/billing/my-subscriptions/', 'account', [], 'turnOffRenew', 'Software', { android: 'com.nordvpn.android' }),
  svc('expressvpn', 'ExpressVPN', 'https://www.expressvpn.com/subscriptions', 'account', [], 'turnOffRenew', 'Software', { android: 'com.expressvpn.vpn' }),
  svc('proton', 'Proton', 'https://account.proton.me/dashboard', 'account', [], 'cancelSubscription', 'Software'),
  svc('one_password', '1Password', 'https://my.1password.com/', 'account', ['billing'], 'cancelSubscription', 'Software', { keywords: ['1password'] }),
  cn('baidu_netdisk', '百度网盘', 'Cloud Storage', ['baidu netdisk']),
  cn('wps', 'WPS会员', 'Software', ['wps']),

  // ── Dating ──
  svc('tinder', 'Tinder', 'https://tinder.com/', 'account', ['settings'], 'cancelSubscription', 'Dating', { inApp: true, android: 'com.tinder' }),
  svc('bumble', 'Bumble', 'https://bumble.com/', 'account', ['settings'], 'cancelSubscription', 'Dating', { inApp: true, android: 'com.bumble.app' }),
  svc('hinge', 'Hinge', '', 'app', ['settings', 'subscription'], 'cancelSubscription', 'Dating', { inApp: true, android: 'co.hinge.app' }),

  // ── Shopping and delivery memberships ──
  svc('amazon_prime', 'Amazon Prime', 'https://www.amazon.com/mc', 'account', ['membership'], 'endMembership', 'Shopping', { keywords: ['amazon prime', 'prime video', 'prime membership'] }),
  svc('dashpass', 'DashPass', 'https://www.doordash.com/consumer/membership/', 'account', [], 'endMembership', 'Food'),
  svc('uber_one', 'Uber One', '', 'app', ['account', 'membership'], 'endMembership', 'Food'),
  svc('walmart_plus', 'Walmart+', 'https://www.walmart.com/plus/account', 'account', [], 'cancelMembership', 'Shopping'),
  svc('hellofresh', 'HelloFresh', 'https://www.hellofresh.com/account-settings', 'account', ['plan'], 'cancelPlan', 'Food', { keywords: ['hello fresh'] }),
  cn('jd_plus', '京东PLUS', 'Shopping', ['jd plus']),
  cn('meituan_vip', '美团会员', 'Food'),
  cn('eleme_vip', '饿了么超级吃货卡', 'Food'),
  cn('88vip', '88VIP', 'Shopping'),

  // ── Business tools (Business Tools reads these through cancelGuidanceFor) ──
  svc('aws', 'AWS', 'https://console.aws.amazon.com/billing/home', 'account', ['account'], 'closeAccount', 'Business software', { keywords: ['amazon web services'] }),
  svc('hubspot', 'HubSpot', 'https://app.hubspot.com/', 'account', ['account', 'billing'], 'cancelSubscription', 'Business software'),
  svc('asana', 'Asana', 'https://app.asana.com/admin/billing', 'account', [], 'downgradeFree', 'Business software'),
  svc('atlassian', 'Atlassian', 'https://admin.atlassian.com/', 'account', ['billing'], 'cancelSubscription', 'Business software', { keywords: ['jira', 'confluence', 'bitbucket', 'trello'] }),
  svc('vercel', 'Vercel', 'https://vercel.com/account/billing', 'account', [], 'downgradeFree', 'Business software'),
  svc('netlify', 'Netlify', 'https://app.netlify.com/', 'account', ['workspaceSettings', 'billing'], 'downgradeFree', 'Business software'),
  svc('intercom', 'Intercom', 'https://app.intercom.com/', 'account', ['settings', 'billing'], 'cancelSubscription', 'Business software'),
  svc('zendesk', 'Zendesk', 'https://www.zendesk.com/login/', 'account', ['admin', 'subscription'], 'cancelSubscription', 'Business software'),
  svc('airtable', 'Airtable', 'https://airtable.com/account', 'account', ['billing'], 'downgradeFree', 'Business software'),
  svc('zapier', 'Zapier', 'https://zapier.com/app/settings/billing', 'account', [], 'downgradeFree', 'Business software'),
  svc('loom', 'Loom', 'https://www.loom.com/settings/account', 'account', ['plans'], 'downgradeFree', 'Business software'),
  svc('miro', 'Miro', 'https://miro.com/app/dashboard', 'account', ['settings', 'billing'], 'downgradeFree', 'Business software'),
  svc('monday', 'monday.com', 'https://auth.monday.com/login', 'account', ['admin', 'billing'], 'cancelSubscription', 'Business software'),
  svc('clickup', 'ClickUp', 'https://app.clickup.com/', 'account', ['settings', 'billing'], 'downgradeFree', 'Business software'),
  svc('typeform', 'Typeform', 'https://admin.typeform.com/', 'account', ['account', 'plan'], 'cancelPlan', 'Business software'),
  svc('hotjar', 'Hotjar', 'https://insights.hotjar.com/', 'account', ['account', 'subscription'], 'downgradeFree', 'Business software'),
  svc('mixpanel', 'Mixpanel', 'https://mixpanel.com/settings', 'account', ['billing'], 'downgradeFree', 'Business software'),
];

// ── Where store and wallet subscriptions are cancelled ───────────────────────

/** The App Store's subscriptions: on an iPhone or iPad this opens the system screen. */
export const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';
/** Apple's own guide, for a device that is not an iPhone or iPad. */
export const APPLE_CANCEL_HELP_URL = 'https://support.apple.com/118428';
export const GOOGLE_PLAY_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';
export const PAYPAL_AUTOPAY_URL = 'https://www.paypal.com/myaccount/autopay/';

/** Gyms: each has its own rules, often a letter or a visit and a notice period. */
const GYMS = new Set([
  'planet_fitness', 'equinox', 'la_fitness', 'anytime_fitness', 'orangetheory', 'crunch_fitness', '24_hour_fitness',
  'goodlife_fitness', 'puregym', 'the_gym_group', 'david_lloyd', 'nuffield_health', 'basic_fit', 'fitness_park',
  'keepcool', 'neoness', 'city_club', 'peloton', 'costco_membership',
]);

// ── Finding a service ────────────────────────────────────────────────────────

const BY_KEY = new Map(CANCEL_SERVICES.map((s) => [s.key, s]));

function keywordsOf(s: CancelService): string[] {
  return [s.key.replace(/_/g, ' '), ...(s.keywords ?? [])].map((k) => k.toLowerCase());
}

/** Lower-case words separated by single spaces: "Google_Workspace" → "google workspace". */
function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/[_\-.*/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The service behind a merchant: its key exactly, then the canonical key of
 * whatever was given (a raw bank line, a domain, an older normalised name),
 * then the longest keyword found in it as whole words — so "google workspace"
 * is Google Workspace, not some other Google, and "ADOBE *CREATIVE CLOUD" is
 * Adobe.
 */
export function cancelServiceFor(merchant: string | null | undefined): CancelService | null {
  const raw = (merchant ?? '').trim();
  if (!raw) return null;
  const direct = BY_KEY.get(raw.toLowerCase()) ?? BY_KEY.get(words(raw).replace(/ /g, '_'));
  if (direct) return direct;
  const key = merchantKey(raw);
  const byKey = key ? BY_KEY.get(key) : undefined;
  if (byKey) return byKey;
  const text = ` ${words(raw)} `;
  let best: CancelService | null = null;
  let bestLength = 0;
  for (const s of CANCEL_SERVICES) {
    for (const kw of keywordsOf(s)) {
      if (kw.length > bestLength && text.includes(` ${kw} `)) {
        best = s;
        bestLength = kw.length;
      }
    }
  }
  return best;
}

// ── Steps ────────────────────────────────────────────────────────────────────

function pathText(path: readonly CancelPlace[]): string {
  return path.map((p) => t(`subsUi.guide.place.${p}`)).join(t('subsUi.guide.pathSeparator'));
}

/** A service's own steps, in the reader's language. */
export function serviceSteps(s: CancelService): string[] {
  const steps: string[] = [];
  const name = s.name;
  if (s.open === 'cancel') steps.push(t('subsUi.guide.step.openCancelPage', { name }));
  else if (s.open === 'account') steps.push(t('subsUi.guide.step.openAccount', { name }));
  else steps.push(t('subsUi.guide.step.openApp', { name }));
  if (s.path.length > 0) steps.push(t('subsUi.guide.step.goTo', { path: pathText(s.path) }));
  steps.push(t('subsUi.guide.step.choose', { action: t(`subsUi.guide.action.${s.action}`) }));
  return steps;
}

// ── The guide ────────────────────────────────────────────────────────────────

export type CancelPlatform = 'ios' | 'android' | 'web';

export type CancelGuideKind = 'apple' | 'google_play' | 'paypal' | 'service' | 'contract' | 'membership' | 'generic';

export interface CancelLink {
  url: string;
  label: string;
}

export interface CancelGuide {
  kind: CancelGuideKind;
  title: string;
  /** Says plainly that the user cancels it themselves; Budget only shows the way. */
  intro: string;
  steps: string[];
  /** The page to open first, or null when the steps happen in an app or by contacting them. */
  link: CancelLink | null;
  /** Other places worth a look (the service's own page when a store or PayPal bills it, the stores, a search). */
  more: CancelLink[];
  notes: string[];
  /** The directory's service, when it knows this one. */
  service: CancelService | null;
}

export interface CancelGuideInput {
  /** The subscription's merchant key (merchantNormalized). */
  merchantKey: string;
  /** Its display name. */
  name: string;
  billedVia?: BilledVia | null;
  platform: CancelPlatform;
}

const BILLING_KEYS = new Set(['apple', 'google_play', 'paypal']);

function storeLinks(platform: CancelPlatform): CancelLink[] {
  const appleLink = { url: APPLE_SUBSCRIPTIONS_URL, label: t('subsUi.guide.openApple') };
  const googleLink = { url: GOOGLE_PLAY_SUBSCRIPTIONS_URL, label: t('subsUi.guide.openGoogle') };
  if (platform === 'ios') return [appleLink];
  if (platform === 'android') return [googleLink];
  return [appleLink, googleLink];
}

/** A web search for the steps; Baidu for a Chinese reader, who often cannot reach Google. */
export function searchLink(name: string): CancelLink {
  const query = encodeURIComponent(t('subsUi.guide.searchQuery', { name }));
  const url = getLocale() === 'zh' ? `https://www.baidu.com/s?wd=${query}` : `https://www.google.com/search?q=${query}`;
  return { url, label: t('subsUi.guide.search', { name }) };
}

function serviceLink(s: CancelService): CancelLink | null {
  if (!s.url) return null;
  return {
    url: s.url,
    label: s.open === 'cancel' ? t('subsUi.guide.openCancelPage', { name: s.name }) : t('subsUi.guide.openAccount', { name: s.name }),
  };
}

function googlePlayUrl(pkg: string | undefined): string {
  return pkg ? `${GOOGLE_PLAY_SUBSCRIPTIONS_URL}?package=${encodeURIComponent(pkg)}` : GOOGLE_PLAY_SUBSCRIPTIONS_URL;
}

function appleGuide(name: string, generic: boolean, platform: CancelPlatform, service: CancelService | null): CancelGuide {
  const which = generic ? t('subsUi.guide.whichOne') : t('subsUi.guide.apple.tap', { name });
  const onPhone = platform === 'ios';
  return {
    kind: 'apple',
    title: t('subsUi.guide.title', { name }),
    intro: t('subsUi.guide.introApple'),
    steps: onPhone
      ? [t('subsUi.guide.apple.open'), which, t('subsUi.guide.apple.confirm')]
      : [t('subsUi.guide.apple.iphone'), t('subsUi.guide.apple.mac'), which, t('subsUi.guide.apple.confirm')],
    link: onPhone
      ? { url: APPLE_SUBSCRIPTIONS_URL, label: t('subsUi.guide.openApple') }
      : { url: APPLE_CANCEL_HELP_URL, label: t('subsUi.guide.openAppleHelp') },
    more: [],
    notes: [t('subsUi.guide.apple.note')],
    service,
  };
}

function googleGuide(name: string, generic: boolean, service: CancelService | null): CancelGuide {
  return {
    kind: 'google_play',
    title: t('subsUi.guide.title', { name }),
    intro: t('subsUi.guide.introGoogle'),
    steps: [
      t('subsUi.guide.google.open'),
      generic ? t('subsUi.guide.whichOne') : t('subsUi.guide.google.choose', { name }),
      t('subsUi.guide.google.confirm'),
    ],
    link: { url: googlePlayUrl(generic ? undefined : service?.android), label: t('subsUi.guide.openGoogle') },
    more: [],
    notes: [t('subsUi.guide.google.note')],
    service,
  };
}

function paypalGuide(name: string, generic: boolean, service: CancelService | null): CancelGuide {
  const own = service ? serviceLink(service) : null;
  return {
    kind: 'paypal',
    title: t('subsUi.guide.title', { name }),
    intro: t('subsUi.guide.introPayPal'),
    steps: [
      t('subsUi.guide.paypal.open'),
      generic ? t('subsUi.guide.whichOne') : t('subsUi.guide.paypal.choose', { name }),
      t('subsUi.guide.paypal.confirm'),
    ],
    link: { url: PAYPAL_AUTOPAY_URL, label: t('subsUi.guide.openPayPal') },
    more: own ? [own] : [],
    notes: generic ? [] : [t('subsUi.guide.paypal.note', { name })],
    service,
  };
}

/**
 * How to cancel one subscription. Who bills it decides where (the App Store,
 * Google Play, PayPal); otherwise the service's own page, the contract guide,
 * or the generic one. Never a promise that Budget cancels it.
 */
export function cancelGuide(input: CancelGuideInput): CancelGuide {
  const key = (input.merchantKey ?? '').trim();
  const service = cancelServiceFor(key) ?? cancelServiceFor(input.name);
  const name = (input.name ?? '').trim() || service?.name || key;
  // A charge that names only the store ("APPLE.COM/BILL") does not say which subscription it is.
  const generic = BILLING_KEYS.has(key) && !service;

  if (input.billedVia === 'apple') return appleGuide(name, generic, input.platform, service);
  if (input.billedVia === 'google_play') return googleGuide(name, generic, service);
  if (input.billedVia === 'paypal') return paypalGuide(name, generic, service);
  if (key === 'apple' || service?.store === 'apple') return appleGuide(name, key === 'apple' && !service, input.platform, service);
  if (key === 'google_play') return googleGuide(name, true, null);
  if (key === 'paypal') return paypalGuide(name, true, null);

  if (service) {
    const notes: string[] = [];
    const more: CancelLink[] = [];
    if (service.inApp) {
      notes.push(t('subsUi.guide.inAppNote'));
      more.push(...storeLinks(input.platform));
    }
    if (service.autoDebit) notes.push(t('subsUi.guide.autoDebitNote'));
    notes.push(t('subsUi.guide.keepProof'));
    return {
      kind: 'service',
      title: t('subsUi.guide.title', { name }),
      intro: t('subsUi.guide.introService', { name }),
      steps: serviceSteps(service),
      link: serviceLink(service),
      more,
      notes,
      service,
    };
  }

  const telecom = aliasFor(key)?.kind === 'telecom';
  if (telecom || GYMS.has(key)) {
    const ns = telecom ? 'contract' : 'membership';
    return {
      kind: telecom ? 'contract' : 'membership',
      title: t('subsUi.guide.title', { name }),
      intro: t('subsUi.guide.introService', { name }),
      steps: [t(`subsUi.guide.${ns}.step1`, { name }), t(`subsUi.guide.${ns}.step2`), t(`subsUi.guide.${ns}.step3`)],
      link: null,
      more: [searchLink(name)],
      notes: [],
      service: null,
    };
  }

  return {
    kind: 'generic',
    title: t('subsUi.guide.title', { name }),
    intro: t('subsUi.guide.introService', { name }),
    steps: [t('subsUi.guide.generic.step1', { name }), t('subsUi.guide.generic.step2'), t('subsUi.guide.generic.step3')],
    link: null,
    more: [...storeLinks(input.platform), searchLink(name)],
    notes: [],
    service: null,
  };
}

// ── The older shape, still read by Business Tools ────────────────────────────

/**
 * One directory entry as business-subscription-detection reads it. `steps`
 * is resolved each time it is read, so it is always in the current language.
 */
export interface CancelDirectoryEntry {
  key: string;
  keywords: string[];
  displayName: string;
  cancelUrl: string;
  readonly steps: string[];
  category: string;
  native?: 'apple' | 'google';
}

function entryOf(s: CancelService): CancelDirectoryEntry {
  return {
    key: s.key,
    keywords: keywordsOf(s),
    displayName: s.name,
    cancelUrl: s.store === 'apple' ? APPLE_SUBSCRIPTIONS_URL : s.url,
    get steps() {
      if (s.store === 'apple') {
        return [t('subsUi.guide.apple.iphone'), t('subsUi.guide.apple.tap', { name: s.name }), t('subsUi.guide.apple.confirm')];
      }
      return serviceSteps(s);
    },
    category: s.category,
    ...(s.store === 'apple' ? { native: 'apple' as const } : {}),
  };
}

export const CANCEL_DIRECTORY: CancelDirectoryEntry[] = CANCEL_SERVICES.map(entryOf);

const ENTRY_BY_KEY = new Map(CANCEL_DIRECTORY.map((e) => [e.key, e]));

/** The directory entry for a merchant (its key, a raw name or an older normalised one), if Budget knows it. */
export function findCancelEntry(normalizedMerchant: string): CancelDirectoryEntry | null {
  const s = cancelServiceFor(normalizedMerchant);
  return s ? (ENTRY_BY_KEY.get(s.key) ?? null) : null;
}
