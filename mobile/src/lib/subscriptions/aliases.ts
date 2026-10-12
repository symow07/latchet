/**
 * Who a charge is from: the alias table behind merchantKey.
 *
 * Each entry is one canonical merchant: its key (the identity a subscription
 * row is stored under — `sub_<key>`), its display name, what kind of merchant
 * it is, the spellings banks, card networks, statements and receipts use for
 * it, and the domains its email comes from.
 *
 * Kinds:
 *  - `sub`      a subscription service: needs less evidence than an unknown merchant.
 *  - `telecom`  phone, internet, TV licence: a subscription whose bill varies.
 *  - `billing`  a billing intermediary (Apple, Google Play, PayPal). Its key is
 *               only used when a charge names nothing else.
 *  - `habit`    coffee, groceries, fuel, transport, restaurants, marketplaces:
 *               spending that recurs but is never a subscription.
 *
 * Names are matched as whole words (lower-case, accents stripped, `&` dropped
 * so AT&T reads "att", `+` read as "plus"); a name of seven or more letters
 * also matches as the start of a word, so "NETFLIXCOM" or "YOUTUBEPREMIUM"
 * still resolve. Chinese and Arabic names match anywhere in the text. When
 * several names match, the longest wins ("orange bleue" over "orange", "uber
 * one" over "uber"). A name written with a leading `~` is a parent brand
 * ("~microsoft", "~amazon"): it only counts when nothing more specific
 * matches, so "MICROSOFT*XBOX" is Xbox and "AMAZON PRIME" is Prime.
 */

export type MerchantKind = 'sub' | 'telecom' | 'billing' | 'habit';

export interface AliasEntry {
  key: string;
  name: string;
  kind: MerchantKind;
  names: readonly string[];
  domains: readonly string[];
}

type Row = [key: string, name: string, names: string[], domains?: string[]];

const sub = (rows: Row[]): AliasEntry[] =>
  rows.map(([key, name, names, domains = []]) => ({ key, name, kind: 'sub', names, domains }));
const telecom = (rows: Row[]): AliasEntry[] =>
  rows.map(([key, name, names, domains = []]) => ({ key, name, kind: 'telecom', names, domains }));
const habit = (rows: Row[]): AliasEntry[] =>
  rows.map(([key, name, names, domains = []]) => ({ key, name, kind: 'habit', names, domains }));

export const ALIASES: readonly AliasEntry[] = [
  // ── Billing intermediaries ────────────────────────────────────────────────
  { key: 'apple', name: 'Apple', kind: 'billing', names: ['~apple', '~itunes', 'apple services', 'apple com bill', 'apl itunes'], domains: ['apple.com', 'itunes.com', 'email.apple.com'] },
  { key: 'google_play', name: 'Google Play', kind: 'billing', names: ['google play', 'google payment', '~google'], domains: ['google.com', 'play.google.com', 'googleplay.com'] },
  { key: 'paypal', name: 'PayPal', kind: 'billing', names: ['paypal'], domains: ['paypal.com', 'paypal.fr', 'paypal.co.uk', 'paypal.de'] },

  // ── Video streaming ───────────────────────────────────────────────────────
  ...sub([
    ['netflix', 'Netflix', ['netflix', 'netflix international', 'netflix inc'], ['netflix.com']],
    ['hulu', 'Hulu', ['hulu', 'hulu llc'], ['hulu.com', 'hulumail.com']],
    ['disney_plus', 'Disney+', ['disney plus', 'disneyplus', 'disney streaming'], ['disneyplus.com', 'disneystreaming.com']],
    ['hbo_max', 'Max', ['hbo max', 'hbomax', 'hbo', 'max com'], ['max.com', 'hbomax.com']],
    ['paramount_plus', 'Paramount+', ['paramount plus', 'paramountplus', 'cbs all access'], ['paramountplus.com']],
    ['peacock', 'Peacock', ['peacock', 'peacocktv', 'peacock tv', 'peacock premium'], ['peacocktv.com']],
    ['apple_tv', 'Apple TV+', ['apple tv plus', 'apple tv'], ['tv.apple.com']],
    ['youtube_tv', 'YouTube TV', ['youtube tv', 'youtubetv'], ['tv.youtube.com']],
    ['youtube_premium', 'YouTube Premium', ['youtube premium', 'youtubepremium', '~youtube'], ['youtube.com']],
    ['sling_tv', 'Sling TV', ['sling tv', 'slingtv', 'sling com'], ['sling.com']],
    ['fubo', 'Fubo', ['fubo', 'fubotv', 'fubo tv'], ['fubo.tv']],
    ['philo', 'Philo', ['philo'], ['philo.com']],
    ['crunchyroll', 'Crunchyroll', ['crunchyroll'], ['crunchyroll.com']],
    ['espn_plus', 'ESPN+', ['espn plus', 'espnplus', 'espn'], ['espn.com', 'espnplus.com']],
    ['dazn', 'DAZN', ['dazn'], ['dazn.com']],
    ['now_tv', 'NOW', ['now tv', 'nowtv', 'now entertainment', 'now membership'], ['nowtv.com']],
    ['britbox', 'BritBox', ['britbox'], ['britbox.com', 'britbox.co.uk']],
    ['itvx', 'ITVX', ['itvx', 'itv hub', 'itvx premium'], ['itv.com']],
    ['crave', 'Crave', ['crave', 'cravetv', 'crave tv', 'bell media crave'], ['crave.ca']],
    ['canal_plus', 'Canal+', ['canal plus', 'canalplus', 'groupe canal plus', 'canal sat', 'canalsat', 'mycanal'], ['canalplus.com', 'canal-plus.com', 'mycanal.fr']],
    ['ocs', 'OCS', ['ocs'], ['ocs.fr']],
    ['molotov', 'Molotov', ['molotov', 'molotov tv'], ['molotov.tv']],
    ['shahid', 'Shahid', ['shahid', 'shahid vip', 'mbc shahid', 'شاهد'], ['shahid.net', 'shahid.mbc.net']],
    ['osn_plus', 'OSN+', ['osn plus', 'osnplus', 'osn'], ['osnplus.com', 'osn.com']],
    ['starzplay', 'STARZPLAY', ['starzplay', 'starz play'], ['starzplay.com']],
    ['iqiyi', '爱奇艺', ['爱奇艺', 'iqiyi'], ['iqiyi.com']],
    ['tencent_video', '腾讯视频', ['腾讯视频', 'tencent video', 'wetv'], ['v.qq.com', 'wetv.vip']],
    ['youku', '优酷', ['优酷', 'youku'], ['youku.com']],
    ['bilibili', '哔哩哔哩', ['哔哩哔哩', 'bilibili', 'b站', '大会员'], ['bilibili.com']],
    ['mango_tv', '芒果TV', ['芒果tv', '芒果 tv', 'mgtv'], ['mgtv.com']],
  ]),

  // ── Music and audio ───────────────────────────────────────────────────────
  ...sub([
    ['spotify', 'Spotify', ['spotify', 'spotify ab', 'spotify usa'], ['spotify.com', 'spotifymail.com']],
    ['apple_music', 'Apple Music', ['apple music']],
    ['youtube_music', 'YouTube Music', ['youtube music', 'youtubemusic']],
    ['amazon_music', 'Amazon Music', ['amazon music', 'amazon music unlimited', 'amzn music', 'amazon digital music']],
    ['deezer', 'Deezer', ['deezer'], ['deezer.com']],
    ['tidal', 'Tidal', ['tidal', 'tidal music'], ['tidal.com']],
    ['pandora', 'Pandora', ['pandora com', 'pandora music', 'pandora media'], ['pandora.com']],
    ['siriusxm', 'SiriusXM', ['siriusxm', 'sirius xm', 'sirius'], ['siriusxm.com']],
    ['soundcloud', 'SoundCloud', ['soundcloud'], ['soundcloud.com']],
    ['anghami', 'Anghami', ['anghami', 'أنغامي'], ['anghami.com']],
    ['netease_music', '网易云音乐', ['网易云音乐', '网易云', 'netease cloud music'], ['music.163.com']],
    ['qq_music', 'QQ音乐', ['qq音乐', 'qq music', 'qqmusic'], ['y.qq.com']],
    ['kugou', '酷狗音乐', ['酷狗'], ['kugou.com']],
    ['audible', 'Audible', ['audible'], ['audible.com', 'audible.co.uk', 'audible.fr', 'audible.ca']],
    ['kindle_unlimited', 'Kindle Unlimited', ['kindle unlimited', 'kindle unltd']],
    ['scribd', 'Scribd', ['scribd', 'everand'], ['scribd.com']],
    ['storytel', 'Storytel', ['storytel'], ['storytel.com']],
    ['ximalaya', '喜马拉雅', ['喜马拉雅', 'ximalaya'], ['ximalaya.com']],
    ['apple_news', 'Apple News+', ['apple news plus', 'apple news']],
  ]),

  // ── News ──────────────────────────────────────────────────────────────────
  ...sub([
    ['nyt', 'The New York Times', ['new york times', 'nytimes', 'ny times', 'nyt'], ['nytimes.com']],
    ['wsj', 'The Wall Street Journal', ['wall street journal', 'wsj', 'dow jones'], ['wsj.com', 'dowjones.com']],
    ['washington_post', 'The Washington Post', ['washington post', 'washingtonpost', 'wapo'], ['washingtonpost.com']],
    ['the_economist', 'The Economist', ['economist', 'the economist', 'economist newspaper'], ['economist.com']],
    ['the_atlantic', 'The Atlantic', ['the atlantic', 'theatlantic', 'atlantic monthly'], ['theatlantic.com']],
    ['the_guardian', 'The Guardian', ['the guardian', 'guardian news', 'guardian media'], ['theguardian.com']],
    ['financial_times', 'Financial Times', ['financial times', 'ft com'], ['ft.com']],
    ['the_times', 'The Times', ['the times', 'times newspapers', 'thetimes'], ['thetimes.co.uk', 'thetimes.com']],
    ['the_telegraph', 'The Telegraph', ['the telegraph', 'telegraph media'], ['telegraph.co.uk']],
    ['le_monde', 'Le Monde', ['le monde', 'lemonde'], ['lemonde.fr']],
    ['le_figaro', 'Le Figaro', ['le figaro', 'figaro'], ['lefigaro.fr']],
    ['mediapart', 'Mediapart', ['mediapart'], ['mediapart.fr']],
    ['l_equipe', "L'Équipe", ['l equipe', 'lequipe'], ['lequipe.fr']],
    ['liberation', 'Libération', ['journal liberation', 'liberation fr'], ['liberation.fr']],
    ['le_parisien', 'Le Parisien', ['le parisien'], ['leparisien.fr']],
    ['medium', 'Medium', ['medium com', 'medium corporation'], ['medium.com']],
    ['substack', 'Substack', ['substack'], ['substack.com']],
    ['patreon', 'Patreon', ['patreon'], ['patreon.com']],
    ['the_athletic', 'The Athletic', ['the athletic', 'theathletic'], ['theathletic.com']],
    ['bloomberg', 'Bloomberg', ['bloomberg'], ['bloomberg.com', 'bloomberg.net']],
  ]),

  // ── Cloud, software, games ────────────────────────────────────────────────
  ...sub([
    ['icloud', 'iCloud+', ['icloud', 'icloud plus', 'icloud storage'], ['icloud.com']],
    ['apple_one', 'Apple One', ['apple one']],
    ['apple_arcade', 'Apple Arcade', ['apple arcade']],
    ['google_one', 'Google One', ['google one', 'googleone', 'google storage', 'google gemini'], ['one.google.com']],
    ['google_workspace', 'Google Workspace', ['google workspace', 'gsuite', 'g suite']],
    ['dropbox', 'Dropbox', ['dropbox'], ['dropbox.com', 'dropboxmail.com']],
    ['pcloud', 'pCloud', ['pcloud'], ['pcloud.com']],
    ['baidu_netdisk', '百度网盘', ['百度网盘', '百度云', 'baidu netdisk'], ['pan.baidu.com']],
    ['microsoft_365', 'Microsoft 365', ['microsoft 365', 'office 365', 'microsoft office', 'msft 365', '~microsoft', '~msft'], ['microsoft.com']],
    ['xbox_game_pass', 'Xbox Game Pass', ['xbox game pass', 'game pass', 'xbox'], ['xbox.com']],
    ['playstation_plus', 'PlayStation Plus', ['playstation plus', 'playstation network', 'playstation', 'ps plus', 'psplus', '~sony interactive', 'psn'], ['playstation.com']],
    ['nintendo_online', 'Nintendo Switch Online', ['nintendo switch online', 'nintendo'], ['nintendo.com']],
    ['adobe', 'Adobe', ['adobe', 'adobe systems', 'creative cloud', 'photoshop', 'lightroom', 'acrobat'], ['adobe.com']],
    ['canva', 'Canva', ['canva', 'canva pro'], ['canva.com']],
    ['notion', 'Notion', ['notion', 'notion so', 'notion labs'], ['notion.so']],
    ['slack', 'Slack', ['slack', 'slack technologies'], ['slack.com']],
    ['zoom', 'Zoom', ['zoom', 'zoom us', 'zoom video', 'zoom com'], ['zoom.us']],
    ['github', 'GitHub', ['github'], ['github.com']],
    ['figma', 'Figma', ['figma'], ['figma.com']],
    ['linear', 'Linear', ['linear', 'linear app'], ['linear.app']],
    ['evernote', 'Evernote', ['evernote'], ['evernote.com']],
    ['todoist', 'Todoist', ['todoist'], ['todoist.com']],
    ['one_password', '1Password', ['1password', 'agilebits'], ['1password.com']],
    ['lastpass', 'LastPass', ['lastpass'], ['lastpass.com']],
    ['dashlane', 'Dashlane', ['dashlane'], ['dashlane.com']],
    ['bitwarden', 'Bitwarden', ['bitwarden'], ['bitwarden.com']],
    ['grammarly', 'Grammarly', ['grammarly'], ['grammarly.com']],
    ['duolingo', 'Duolingo', ['duolingo'], ['duolingo.com']],
    ['babbel', 'Babbel', ['babbel'], ['babbel.com']],
    ['headspace', 'Headspace', ['headspace'], ['headspace.com']],
    ['calm', 'Calm', ['calm com', 'calm app'], ['calm.com']],
    ['strava', 'Strava', ['strava'], ['strava.com']],
    ['linkedin_premium', 'LinkedIn Premium', ['linkedin premium', 'linkedin', 'lnkd'], ['linkedin.com']],
    ['wps', 'WPS会员', ['wps会员', 'wps office', '金山办公'], ['wps.cn']],
    ['discord', 'Discord Nitro', ['discord nitro', 'discord'], ['discord.com']],
    ['twitch', 'Twitch', ['twitch'], ['twitch.tv']],
  ]),

  // ── AI tools ──────────────────────────────────────────────────────────────
  ...sub([
    ['chatgpt', 'ChatGPT', ['chatgpt', 'openai', 'open ai', 'chatgpt subscription'], ['openai.com', 'chatgpt.com']],
    ['claude', 'Claude', ['claude ai', 'anthropic'], ['anthropic.com', 'claude.ai', 'claude.com']],
    ['midjourney', 'Midjourney', ['midjourney'], ['midjourney.com']],
    ['perplexity', 'Perplexity', ['perplexity', 'perplexity ai'], ['perplexity.ai']],
    ['cursor', 'Cursor', ['cursor ai', 'anysphere'], ['cursor.com', 'cursor.sh']],
  ]),

  // ── VPNs ──────────────────────────────────────────────────────────────────
  ...sub([
    ['nordvpn', 'NordVPN', ['nordvpn', 'nord vpn', 'nordsec', 'nord security'], ['nordvpn.com']],
    ['expressvpn', 'ExpressVPN', ['expressvpn', 'express vpn'], ['expressvpn.com']],
    ['surfshark', 'Surfshark', ['surfshark'], ['surfshark.com']],
    ['proton', 'Proton', ['proton ag', 'protonvpn', 'proton vpn', 'proton mail', 'protonmail', 'proton'], ['proton.me', 'protonmail.com']],
    ['cyberghost', 'CyberGhost', ['cyberghost'], ['cyberghostvpn.com']],
    ['private_internet_access', 'Private Internet Access', ['private internet access', 'privateinternetaccess'], ['privateinternetaccess.com']],
  ]),

  // ── Dating ────────────────────────────────────────────────────────────────
  ...sub([
    ['tinder', 'Tinder', ['tinder', 'tinder plus', 'tinder gold'], ['gotinder.com', 'tinder.com']],
    ['bumble', 'Bumble', ['bumble'], ['bumble.com']],
    ['hinge', 'Hinge', ['hinge'], ['hinge.co']],
    ['match', 'Match', ['match com', 'match group'], ['match.com']],
    ['okcupid', 'OkCupid', ['okcupid'], ['okcupid.com']],
    ['meetic', 'Meetic', ['meetic'], ['meetic.fr', 'meetic.com']],
    ['happn', 'happn', ['happn'], ['happn.com']],
    ['grindr', 'Grindr', ['grindr'], ['grindr.com']],
  ]),

  // ── Gyms ──────────────────────────────────────────────────────────────────
  ...sub([
    ['planet_fitness', 'Planet Fitness', ['planet fitness', 'planet fit', 'pf club fees'], ['planetfitness.com']],
    ['equinox', 'Equinox', ['equinox'], ['equinox.com']],
    ['la_fitness', 'LA Fitness', ['la fitness'], ['lafitness.com']],
    ['anytime_fitness', 'Anytime Fitness', ['anytime fitness'], ['anytimefitness.com']],
    ['orangetheory', 'Orangetheory', ['orangetheory', 'orange theory'], ['orangetheory.com']],
    ['crunch_fitness', 'Crunch Fitness', ['crunch fitness', 'crunch gym'], ['crunch.com']],
    ['24_hour_fitness', '24 Hour Fitness', ['24 hour fitness', '24hr fitness'], ['24hourfitness.com']],
    ['goodlife_fitness', 'GoodLife Fitness', ['goodlife fitness', 'goodlife'], ['goodlifefitness.com']],
    ['peloton', 'Peloton', ['peloton'], ['onepeloton.com']],
    ['puregym', 'PureGym', ['puregym', 'pure gym'], ['puregym.com']],
    ['the_gym_group', 'The Gym Group', ['the gym group', 'gym group'], ['thegymgroup.com']],
    ['david_lloyd', 'David Lloyd', ['david lloyd'], ['davidlloyd.co.uk']],
    ['nuffield_health', 'Nuffield Health', ['nuffield health'], ['nuffieldhealth.com']],
    ['basic_fit', 'Basic-Fit', ['basic fit', 'basicfit'], ['basic-fit.com']],
    ['fitness_park', 'Fitness Park', ['fitness park'], ['fitnesspark.fr']],
    ['keepcool', 'Keepcool', ['keepcool', 'keep cool'], ['keepcool.fr']],
    ['neoness', 'Neoness', ['neoness'], ['neoness.fr']],
    ['l_orange_bleue', "L'Orange Bleue", ['orange bleue'], ['lorangebleue.fr']],
    ['city_club', 'City Club', ['city club'], ['cityclub.ma']],
  ]),

  // ── Delivery and shopping memberships, meal kits ──────────────────────────
  ...sub([
    ['amazon_prime', 'Amazon Prime', ['amazon prime', 'amazonprime', 'amzn prime', 'prime video', 'primevideo', 'amazon video', 'prime membership'], ['primevideo.com']],
    ['dashpass', 'DashPass', ['dashpass', 'doordash dashpass'], []],
    ['uber_one', 'Uber One', ['uber one', 'uber pass'], []],
    ['grubhub_plus', 'Grubhub+', ['grubhub plus', 'grubhubplus'], []],
    ['instacart_plus', 'Instacart+', ['instacart plus', 'instacart express'], []],
    ['walmart_plus', 'Walmart+', ['walmart plus', 'walmartplus'], []],
    ['deliveroo_plus', 'Deliveroo Plus', ['deliveroo plus'], []],
    ['glovo_prime', 'Glovo Prime', ['glovo prime'], []],
    ['costco_membership', 'Costco membership', ['costco membership', 'costco annual membership'], []],
    ['jd_plus', '京东PLUS', ['京东plus', '京东 plus', 'jd plus', 'plus会员'], []],
    ['88vip', '88VIP', ['88vip'], []],
    ['meituan_vip', '美团会员', ['美团会员', '美团外卖会员', 'meituan vip'], []],
    ['eleme_vip', '饿了么超级吃货卡', ['超级吃货卡', '饿了么会员', 'eleme vip'], []],
    ['hellofresh', 'HelloFresh', ['hellofresh', 'hello fresh'], ['hellofresh.com', 'hellofresh.co.uk', 'hellofresh.fr', 'hellofresh.ca']],
    ['blue_apron', 'Blue Apron', ['blue apron'], ['blueapron.com']],
    ['gousto', 'Gousto', ['gousto'], ['gousto.co.uk']],
  ]),

  // ── Phone, internet, TV: subscriptions whose bills vary ───────────────────
  ...telecom([
    // United States and Canada
    ['verizon', 'Verizon', ['verizon', 'verizon wireless', 'vzwrlss', 'vz wireless'], ['verizon.com', 'verizonwireless.com']],
    ['att', 'AT&T', ['att', 'at t', 'att wireless', 'att uverse'], ['att.com']],
    ['t_mobile', 'T-Mobile', ['t mobile', 'tmobile'], ['t-mobile.com']],
    ['xfinity', 'Xfinity', ['xfinity', 'comcast'], ['xfinity.com', 'comcast.net']],
    ['spectrum', 'Spectrum', ['spectrum', 'charter communications', 'charter comm'], ['spectrum.com', 'charter.net']],
    ['cox', 'Cox', ['cox comm', 'cox communications', 'cox cable'], ['cox.com']],
    ['google_fi', 'Google Fi', ['google fi'], ['fi.google.com']],
    ['mint_mobile', 'Mint Mobile', ['mint mobile'], ['mintmobile.com']],
    ['visible', 'Visible', ['visible wireless'], ['visible.com']],
    ['cricket', 'Cricket Wireless', ['cricket wireless'], ['cricketwireless.com']],
    ['optimum', 'Optimum', ['optimum'], ['optimum.net']],
    ['rogers', 'Rogers', ['rogers', 'rogers wireless', 'rogers communications'], ['rogers.com']],
    ['bell', 'Bell', ['bell canada', 'bell mobility', 'bell internet'], ['bell.ca']],
    ['telus', 'Telus', ['telus'], ['telus.com']],
    ['fido', 'Fido', ['fido', 'fido mobile'], ['fido.ca']],
    ['koodo', 'Koodo', ['koodo'], ['koodomobile.com']],
    ['virgin_plus', 'Virgin Plus', ['virgin plus', 'virgin mobile canada'], ['virginplus.ca']],
    ['freedom_mobile', 'Freedom Mobile', ['freedom mobile'], ['freedommobile.ca']],
    ['videotron', 'Vidéotron', ['videotron'], ['videotron.com']],
    // United Kingdom
    ['bt', 'BT', ['bt', 'bt group', 'british telecom', 'bt broadband'], ['bt.com']],
    ['sky', 'Sky', ['sky', 'sky uk', 'sky digital', 'sky subscription', 'sky broadband', 'sky mobile', 'sky tv'], ['sky.com']],
    ['virgin_media', 'Virgin Media', ['virgin media', 'virginmedia'], ['virginmedia.com']],
    ['ee', 'EE', ['ee', 'ee limited'], ['ee.co.uk']],
    ['o2', 'O2', ['o2', 'o2 uk', 'telefonica uk'], ['o2.co.uk']],
    ['vodafone', 'Vodafone', ['vodafone'], ['vodafone.co.uk', 'vodafone.com']],
    ['three_uk', 'Three', ['three uk', 'three mobile', 'hutchison 3g'], ['three.co.uk']],
    ['giffgaff', 'giffgaff', ['giffgaff'], ['giffgaff.com']],
    ['talktalk', 'TalkTalk', ['talktalk', 'talk talk'], ['talktalk.co.uk']],
    ['plusnet', 'Plusnet', ['plusnet'], ['plus.net']],
    ['tv_licence', 'TV Licence', ['tv licence', 'tv licensing', 'tvlicensing', 'tv licence mbp'], ['tvlicensing.co.uk']],
    // France
    ['free_mobile', 'Free Mobile', ['free mobile', 'freemobile'], ['free-mobile.fr', 'mobile.free.fr']],
    ['freebox', 'Freebox', ['freebox', 'free telecom', 'free sas', 'free haut debit'], ['free.fr']],
    ['sfr', 'SFR', ['sfr', 'red by sfr', 'sfr box'], ['sfr.fr']],
    ['bouygues_telecom', 'Bouygues Telecom', ['bouygues telecom', 'bouygues', 'byou', 'bbox'], ['bouyguestelecom.fr']],
    ['sosh', 'Sosh', ['sosh'], ['sosh.fr']],
    // France and Morocco: one Orange (Orange Maroc was Méditel)
    ['orange', 'Orange', ['orange', 'orange sa', 'orange france', 'orange maroc', 'orange mobile', 'meditel'], ['orange.fr', 'orange.ma']],
    // Morocco
    ['inwi', 'inwi', ['inwi', 'wana corporate', 'إنوي'], ['inwi.ma']],
    ['maroc_telecom', 'Maroc Telecom', ['maroc telecom', 'iam', 'itissalat al maghrib', 'menara', 'اتصالات المغرب'], ['iam.ma']],
  ]),

  // ── Habits: recurring spending that is never a subscription ───────────────
  ...habit([
    // Coffee and bakeries
    ['starbucks', 'Starbucks', ['starbucks', '星巴克']],
    ['costa', 'Costa Coffee', ['costa coffee', 'costa']],
    ['pret_a_manger', 'Pret A Manger', ['pret a manger', 'pret']],
    ['caffe_nero', 'Caffè Nero', ['caffe nero']],
    ['tim_hortons', 'Tim Hortons', ['tim hortons']],
    ['dunkin', "Dunkin'", ['dunkin', 'dunkin donuts']],
    ['blue_bottle', 'Blue Bottle Coffee', ['blue bottle']],
    ['peets', "Peet's Coffee", ['peets', 'peet s coffee']],
    ['paul', 'Paul', ['boulangerie paul']],
    ['columbus_cafe', 'Columbus Café', ['columbus cafe']],
    ['luckin', '瑞幸咖啡', ['瑞幸', 'luckin']],
    ['cotti', '库迪咖啡', ['库迪']],
    ['mixue', '蜜雪冰城', ['蜜雪冰城']],
    ['heytea', '喜茶', ['喜茶']],
    // Fast food and restaurants
    ['mcdonalds', "McDonald's", ['mcdonald', 'mcdonalds', 'mcdo', '麦当劳']],
    ['kfc', 'KFC', ['kfc', '肯德基']],
    ['burger_king', 'Burger King', ['burger king']],
    ['subway', 'Subway', ['subway']],
    ['chipotle', 'Chipotle', ['chipotle']],
    ['dominos', "Domino's", ['domino s', 'dominos']],
    ['pizza_hut', 'Pizza Hut', ['pizza hut']],
    ['taco_bell', 'Taco Bell', ['taco bell']],
    ['five_guys', 'Five Guys', ['five guys']],
    // Delivery orders and rides (the memberships above are separate keys)
    ['uber', 'Uber', ['uber', 'uber trip', 'uber eats', 'ubr', 'uber bv']],
    ['lyft', 'Lyft', ['lyft']],
    ['bolt', 'Bolt', ['bolt eu', 'bolt']],
    ['doordash', 'DoorDash', ['doordash']],
    ['grubhub', 'Grubhub', ['grubhub']],
    ['instacart', 'Instacart', ['instacart']],
    ['deliveroo', 'Deliveroo', ['deliveroo']],
    ['just_eat', 'Just Eat', ['just eat', 'justeat']],
    ['glovo', 'Glovo', ['glovo']],
    ['careem', 'Careem', ['careem']],
    ['heetch', 'Heetch', ['heetch']],
    ['meituan', '美团', ['美团', 'meituan']],
    ['eleme', '饿了么', ['饿了么', 'eleme']],
    ['didi', '滴滴出行', ['滴滴', 'didi']],
    // Public transport and passes
    ['tfl', 'TfL', ['tfl', 'tfl travel', 'transport for london']],
    ['sncf', 'SNCF', ['sncf', 'sncf connect', 'ouigo']],
    ['ratp', 'RATP', ['ratp']],
    ['navigo', 'Navigo', ['navigo', 'comutitres']],
    ['mta', 'MTA', ['mta', 'nyct', 'omny']],
    ['oncf', 'ONCF', ['oncf']],
    ['trainline', 'Trainline', ['trainline']],
    // Groceries
    ['tesco', 'Tesco', ['tesco']],
    ['sainsburys', "Sainsbury's", ['sainsbury', 'sainsburys']],
    ['asda', 'Asda', ['asda']],
    ['morrisons', 'Morrisons', ['morrisons']],
    ['aldi', 'Aldi', ['aldi']],
    ['lidl', 'Lidl', ['lidl']],
    ['waitrose', 'Waitrose', ['waitrose']],
    ['marks_spencer', 'Marks & Spencer', ['marks spencer', 'marks and spencer']],
    ['carrefour', 'Carrefour', ['carrefour', 'carrefour market', 'carrefour city']],
    ['auchan', 'Auchan', ['auchan']],
    ['leclerc', 'E.Leclerc', ['leclerc', 'e leclerc']],
    ['intermarche', 'Intermarché', ['intermarche']],
    ['monoprix', 'Monoprix', ['monoprix']],
    ['franprix', 'Franprix', ['franprix']],
    ['picard', 'Picard', ['picard']],
    ['marjane', 'Marjane', ['marjane']],
    ['bim', 'BIM', ['bim']],
    ['acima', 'Acima', ['acima']],
    ['label_vie', 'Label’Vie', ['label vie']],
    ['walmart', 'Walmart', ['walmart', 'wal mart', 'wm supercenter']],
    ['target', 'Target', ['target']],
    ['kroger', 'Kroger', ['kroger']],
    ['safeway', 'Safeway', ['safeway']],
    ['whole_foods', 'Whole Foods', ['whole foods', 'wholefds']],
    ['trader_joes', "Trader Joe's", ['trader joe', 'trader joes']],
    ['costco', 'Costco', ['costco', 'costco whse']],
    ['publix', 'Publix', ['publix']],
    ['loblaws', 'Loblaws', ['loblaws']],
    ['hema', '盒马', ['盒马']],
    ['yonghui', '永辉超市', ['永辉']],
    // Fuel
    ['shell', 'Shell', ['shell', 'shell oil']],
    ['bp', 'BP', ['bp', 'bp connect']],
    ['esso', 'Esso', ['esso']],
    ['exxon', 'ExxonMobil', ['exxon', 'exxonmobil']],
    ['chevron', 'Chevron', ['chevron']],
    ['totalenergies', 'TotalEnergies', ['totalenergies', 'total access', 'total']],
    ['afriquia', 'Afriquia', ['afriquia']],
    ['petro_canada', 'Petro-Canada', ['petro canada']],
    ['sinopec', '中国石化', ['中国石化', 'sinopec']],
    ['petrochina', '中国石油', ['中国石油', 'petrochina']],
    // Marketplaces
    ['amazon', 'Amazon', ['~amazon', '~amzn', 'amazon com', 'amazon digital']],
    ['taobao', '淘宝', ['淘宝', 'taobao']],
    ['tmall', '天猫', ['天猫', 'tmall']],
    ['jd', '京东', ['京东']],
    ['pinduoduo', '拼多多', ['拼多多', 'pinduoduo']],
    ['ebay', 'eBay', ['ebay']],
    ['etsy', 'Etsy', ['etsy']],
    ['aliexpress', 'AliExpress', ['aliexpress']],
    ['shein', 'SHEIN', ['shein']],
    ['temu', 'Temu', ['temu']],
    ['ikea', 'IKEA', ['ikea']],
    ['jumia', 'Jumia', ['jumia']],
  ]),
];

/**
 * Words that make an unknown merchant read as habitual spending (a café, a
 * supermarket, a petrol station) rather than a service.
 */
export const HABIT_WORDS: ReadonlySet<string> = new Set([
  'cafe', 'caffe', 'coffee', 'espresso', 'boulangerie', 'patisserie', 'bakery', 'restaurant',
  'resto', 'brasserie', 'bistro', 'pizza', 'pizzeria', 'burger', 'sushi', 'kebab', 'snack',
  'tacos', 'diner', 'grill', 'bar', 'pub', 'tabac', 'pharmacie', 'pharmacy', 'supermarche',
  'supermarket', 'market', 'marche', 'epicerie', 'grocery', 'groceries', 'deli', 'hanout',
  'boucherie', 'fuel', 'petrol', 'carburant', 'parking', 'peage', 'toll', 'taxi', 'liquor',
]);

/** The same, for scripts without word breaks: matched anywhere in the text. */
export const HABIT_FRAGMENTS: readonly string[] = [
  '咖啡', '餐厅', '餐饮', '饭店', '超市', '便利店', '加油', '外卖', '面馆', '奶茶', '小吃', '食堂',
  'مقهى', 'مطعم',
];
