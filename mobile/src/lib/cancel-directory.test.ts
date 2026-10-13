import { afterEach, describe, expect, test } from 'bun:test';
import {
  APPLE_CANCEL_HELP_URL,
  APPLE_SUBSCRIPTIONS_URL,
  CANCEL_DIRECTORY,
  CANCEL_SERVICES,
  GOOGLE_PLAY_SUBSCRIPTIONS_URL,
  PAYPAL_AUTOPAY_URL,
  cancelGuide,
  cancelServiceFor,
  findCancelEntry,
  type CancelGuide,
  type CancelPlatform,
} from './cancel-directory';
import { cancelGuidanceFor } from './business-subscription-detection';
import { setLocale, t } from './i18n/core';
import { aliasFor } from './subscriptions/merchant';

afterEach(() => setLocale('en'));

const guide = (merchantKey: string, name: string, billedVia: 'apple' | 'google_play' | 'paypal' | null = null, platform: CancelPlatform = 'ios') =>
  cancelGuide({ merchantKey, name, billedVia, platform });

/** Every word a guide puts on screen. */
const words = (g: CancelGuide) => [g.title, g.intro, ...g.steps, ...g.notes, g.link?.label ?? '', ...g.more.map((m) => m.label)];

describe('cancel guide', () => {
  test('a known service: its own cancellation page and short steps, keyed by the canonical merchant key', () => {
    const netflix = guide('netflix', 'Netflix');
    expect(netflix.kind).toBe('service');
    expect(netflix.link).toEqual({ url: 'https://www.netflix.com/cancelplan', label: t('subsUi.guide.openCancelPage', { name: 'Netflix' }) });
    expect(netflix.steps).toEqual([
      t('subsUi.guide.step.openCancelPage', { name: 'Netflix' }),
      t('subsUi.guide.step.choose', { action: t('subsUi.guide.action.finishCancel') }),
    ]);
    expect(netflix.notes).toContain(t('subsUi.guide.keepProof'));

    // An account page with a path through it.
    const disney = guide('disney_plus', 'Disney+');
    expect(disney.link?.url).toBe('https://www.disneyplus.com/account');
    expect(disney.steps).toContain(t('subsUi.guide.step.goTo', { path: t('subsUi.guide.place.subscription') }));
    const notion = guide('notion', 'Notion');
    expect(notion.steps[1]).toBe(
      t('subsUi.guide.step.goTo', { path: `${t('subsUi.guide.place.settings')} › ${t('subsUi.guide.place.plans')}` }),
    );

    // Found by its key, a raw bank line, a domain or an older normalised name — and the most specific wins.
    expect(cancelServiceFor('netflix')?.key).toBe('netflix');
    expect(cancelServiceFor('NETFLIX.COM')?.key).toBe('netflix');
    expect(cancelServiceFor('ADOBE *CREATIVE CLOUD')?.key).toBe('adobe');
    expect(cancelServiceFor('google workspace')?.key).toBe('google_workspace');
    expect(cancelServiceFor('youtube_tv')?.key).toBe('youtube_tv');
    expect(cancelServiceFor('Atlassian Jira')?.key).toBe('atlassian');
    expect(cancelServiceFor('ZZYZX WIDGETS')).toBeNull();
    expect(cancelServiceFor('')).toBeNull();
  });

  test('the steps are in the reader’s language, built from the same places and buttons', () => {
    const en = guide('spotify', 'Spotify').steps;
    setLocale('fr');
    const fr = guide('spotify', 'Spotify');
    expect(fr.steps).not.toEqual(en);
    expect(fr.steps.join(' ')).toContain('« Résilier l\'abonnement »');
    expect(fr.title).toBe('Résilier Spotify');
    setLocale('zh');
    expect(guide('spotify', 'Spotify').steps.join('')).toContain('“取消订阅”');
    setLocale('ar');
    expect(guide('spotify', 'Spotify').steps.join(' ')).toContain('«إلغاء الاشتراك»');

    // A Chinese membership renews through the app and is paid by an automatic deduction.
    setLocale('zh');
    const iqiyi = guide('iqiyi', '爱奇艺');
    expect(iqiyi.link).toBeNull();
    expect(iqiyi.steps[1]).toBe('前往 我的 › 会员中心 › 自动续费管理。');
    expect(iqiyi.notes).toContain(t('subsUi.guide.autoDebitNote'));
  });

  test('billed by Apple: the App Store’s subscriptions on an iPhone, Apple’s own guide anywhere else', () => {
    const viaApple = guide('netflix', 'Netflix', 'apple', 'ios');
    expect(viaApple.kind).toBe('apple');
    expect(viaApple.link?.url).toBe(APPLE_SUBSCRIPTIONS_URL);
    expect(APPLE_SUBSCRIPTIONS_URL).toBe('https://apps.apple.com/account/subscriptions');
    expect(viaApple.steps).toContain(t('subsUi.guide.apple.tap', { name: 'Netflix' }));
    expect(viaApple.intro).toBe(t('subsUi.guide.introStore', { store: t('subsUi.guide.storeApple') }));

    const onAndroid = guide('netflix', 'Netflix', 'apple', 'android');
    expect(onAndroid.link?.url).toBe(APPLE_CANCEL_HELP_URL);
    expect(onAndroid.steps).toContain(t('subsUi.guide.apple.iphone'));

    // Apple's own services are Apple's to cancel, whatever the row says.
    expect(guide('icloud', 'iCloud+').kind).toBe('apple');
    expect(guide('apple_music', 'Apple Music', null, 'web').link?.url).toBe(APPLE_CANCEL_HELP_URL);
    // A charge that names only Apple: find which subscription it is.
    expect(guide('apple', 'Apple', 'apple').steps).toContain(t('subsUi.guide.whichOne'));
  });

  test('billed by Google Play: Play’s subscriptions, on the app’s own entry when its package is known', () => {
    const spotify = guide('spotify', 'Spotify', 'google_play', 'android');
    expect(spotify.kind).toBe('google_play');
    expect(spotify.link).toEqual({
      url: 'https://play.google.com/store/account/subscriptions?package=com.spotify.music',
      label: t('subsUi.guide.openGoogle'),
    });
    expect(spotify.steps).toContain(t('subsUi.guide.google.choose', { name: 'Spotify' }));
    // Unknown package: the subscriptions list itself.
    expect(guide('zzyzx', 'Zzyzx Radio', 'google_play').link?.url).toBe(GOOGLE_PLAY_SUBSCRIPTIONS_URL);
    expect(guide('google_play', 'Google Play').steps).toContain(t('subsUi.guide.whichOne'));
  });

  test('billed through PayPal: PayPal’s automatic payments, and the service’s own page as well', () => {
    const g = guide('spotify', 'Spotify', 'paypal');
    expect(g.kind).toBe('paypal');
    expect(g.link?.url).toBe(PAYPAL_AUTOPAY_URL);
    expect(g.more).toEqual([{ url: 'https://www.spotify.com/account/subscription/', label: t('subsUi.guide.openAccount', { name: 'Spotify' }) }]);
    expect(g.notes).toEqual([t('subsUi.guide.paypal.note', { name: 'Spotify' })]);
  });

  test('an unknown merchant gets the generic guide: its account page, the app stores, the bank', () => {
    const ios = guide('zzyzx_widgets', 'Zzyzx Widgets', null, 'ios');
    expect(ios.kind).toBe('generic');
    expect(ios.link).toBeNull();
    expect(ios.steps).toEqual([
      t('subsUi.guide.generic.step1', { name: 'Zzyzx Widgets' }),
      t('subsUi.guide.generic.step2'),
      t('subsUi.guide.generic.step3'),
    ]);
    expect(ios.more.map((m) => m.url)).toEqual([
      APPLE_SUBSCRIPTIONS_URL,
      `https://www.google.com/search?q=${encodeURIComponent('how to cancel Zzyzx Widgets subscription')}`,
    ]);
    expect(guide('zzyzx_widgets', 'Zzyzx Widgets', null, 'android').more[0]!.url).toBe(GOOGLE_PLAY_SUBSCRIPTIONS_URL);
    // A Chinese reader often cannot reach Google: the search goes to Baidu.
    setLocale('zh');
    expect(guide('zzyzx_widgets', 'Zzyzx Widgets').more.at(-1)!.url).toStartWith('https://www.baidu.com/s?wd=');

    // Phone, internet and TV contracts, and gyms: contact them, mind the notice period.
    setLocale('en');
    expect(aliasFor('sfr')?.kind).toBe('telecom');
    expect(guide('sfr', 'SFR').kind).toBe('contract');
    expect(guide('basic_fit', 'Basic-Fit').kind).toBe('membership');
  });

  test('never a promise of one-tap cancelling: every guide says the user does it, and every button opens a page', () => {
    const forbidden = /one[- ]tap|instantly|automatically cancel|we('ll| will) cancel|budget (will|can|cancels) cancel/i;
    const platforms: CancelPlatform[] = ['ios', 'android', 'web'];
    const vias = [null, 'apple', 'google_play', 'paypal'] as const;
    let checked = 0;
    for (const s of [...CANCEL_SERVICES, { key: 'zzyzx', name: 'Zzyzx' }, { key: 'sfr', name: 'SFR' }]) {
      for (const platform of platforms) {
        for (const via of vias) {
          const g = guide(s.key, s.name, via, platform);
          for (const w of words(g)) {
            expect(w).not.toMatch(forbidden);
            // Every key resolves: no "[missing … translation]", no raw key.
            expect(w).not.toMatch(/missing|subsUi\./);
          }
          // The intro says Budget cannot cancel it.
          expect(g.intro).toMatch(/can't cancel/);
          // Every button opens something; none of them is itself "Cancel".
          for (const l of [g.link, ...g.more]) if (l) expect(l.label).toMatch(/^(Open|Search) /);
          // There is always something to do: steps, and a page or a way to find one.
          expect(g.steps.length).toBeGreaterThanOrEqual(2);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    for (const lang of ['fr', 'zh', 'ar'] as const) {
      setLocale(lang);
      for (const s of CANCEL_SERVICES) {
        for (const via of vias) {
          for (const w of words(guide(s.key, s.name, via, 'web'))) expect(w).not.toMatch(/missing|subsUi\./);
        }
      }
      for (const key of ['sfr', 'basic_fit', 'zzyzx']) {
        for (const w of words(guide(key, 'X', null, 'android'))) expect(w).not.toMatch(/missing|subsUi\./);
      }
    }
  });

  test('every service has a usable page, a unique key, and a real Android package', () => {
    const keys = CANCEL_SERVICES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of CANCEL_SERVICES) {
      if (s.url) expect(s.url).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|$)/);
      else expect(s.open === 'app' || s.store === 'apple').toBe(true);
      if (s.android) expect(s.android).toMatch(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/);
    }
  });

  test('the older directory shape keeps working for Business Tools, now in the reader’s language', () => {
    const netflix = findCancelEntry('netflix')!;
    expect(netflix.cancelUrl).toBe('https://www.netflix.com/cancelplan');
    expect(cancelGuidanceFor('NETFLIX')).toEqual({ instructions: netflix.steps.join(' → '), url: netflix.cancelUrl });
    const english = netflix.steps;
    setLocale('fr');
    expect(netflix.steps).not.toEqual(english);
    expect(cancelGuidanceFor('NETFLIX').instructions).toBe(netflix.steps.join(' → '));
    expect(CANCEL_DIRECTORY.find((e) => e.keywords.includes('google workspace'))?.key).toBe('google_workspace');
    expect(findCancelEntry('icloud')?.native).toBe('apple');
    expect(findCancelEntry('zzyzx widgets')).toBeNull();
  });
});
