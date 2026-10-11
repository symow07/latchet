/**
 * The categorisation fallback: what a description says when the user's own
 * history has nothing to say.
 *
 * Order of evidence, everywhere a transaction is categorised for the user
 * (CSV and Alipay/WeChat import, the quick-add reply, the share and Siri
 * drains): a category the file states, then the user's own history
 * (merchant-memory.ts), then this, then "Other". This table is the last guess
 * before giving up, so it is built to be wrong rarely rather than right often.
 *
 * What it knows:
 *
 *   - Plain words, in all four of the app's languages, always: restaurant,
 *     supermarché, مطعم, 超市, 外卖, 地铁… A word describes the purchase
 *     wherever it was made.
 *   - Brands that trade under one name everywhere (Netflix, Uber, IKEA,
 *     Carrefour, Shell), always.
 *   - Regional brands, chosen by the user's currency: USD/CAD the US and
 *     Canadian chains; EUR the French, Spanish, German, Italian and Benelux
 *     ones; GBP the British ones; MAD the Moroccan ones; CNY the Chinese ones.
 *     A brand list is regional because brand names collide with words and
 *     with each other across markets — "Target" and "BIM" are shops in one
 *     country and ordinary words in another. Chinese brands are also used
 *     whenever the description itself is written in Chinese characters: 美团
 *     means Meituan whatever currency the phone is set to, and a Moroccan
 *     student in Shanghai still deserves to have it recognised.
 *
 * How it matches:
 *
 *   - Latin and Arabic keywords match whole words only, so "bp" never fires
 *     inside "BPM" nor "gas" inside "Gaston". Case, accents and Arabic
 *     diacritics are ignored ("SUPERMARCHE" is "supermarché"), and an Arabic
 *     keyword also matches behind the attached article and particles
 *     (مطعم in المطعم, بالمطعم, للمطعم).
 *   - Chinese keywords match as substrings, because Chinese is not written
 *     with spaces.
 *   - Some longer phrases are known to mean something else, and a keyword
 *     inside one does not count: 京东 inside 南京东路 is a street, not JD.com;
 *     "gas" in "Southwest Gas" is a utility bill, not fuel.
 *
 * When several keywords match:
 *
 *   1. A longer match that contains a shorter one wins: "Uber Eats" is Food
 *      although "Uber" is Transport, 美团打车 is a ride although 美团 is
 *      takeaway, "Tesco Metro" is a supermarket although "metro" is transit.
 *   2. Otherwise a plain word beats a brand. A brand says where the money was
 *      spent; a word says what it was spent on, and that is the category:
 *      "IKEA restaurant" is lunch, "Costco gas" is fuel, "Amazon grocery" is
 *      food.
 *   3. Words that only say how the money left — subscription, abonnement,
 *      اشتراك, 自动续费 — come last, after brands: an "Abonnement Navigo" is
 *      transit and an "abonnement salle de sport" is the gym.
 *   4. Otherwise the leftmost match wins — statements put the merchant first.
 *
 * Pure and dependency-free, so it can be tested without a device and imported
 * from anywhere.
 */

/** The built-in categories a keyword can name. "Other" is the absence of one. */
export type KeywordCategory = 'Food' | 'Gym' | 'Transport' | 'Shopping' | 'Subscriptions';

type Lexicon = { readonly [C in KeywordCategory]?: readonly string[] };

// ── Plain words: every language the app speaks, always on ────────────────────

const WORDS: Lexicon = {
  Food: [
    // English
    'restaurant', 'restaurants', 'cafe', 'cafes', 'coffee', 'coffee shop', 'cafeteria',
    'canteen', 'bistro', 'brasserie', 'diner', 'deli', 'bakery', 'butcher', 'grocery',
    'groceries', 'grocery store', 'grocer', 'supermarket', 'hypermarket', 'minimarket',
    'mini market', 'convenience store', 'farmers market', 'food', 'foods', 'food court',
    'food truck', 'fast food', 'meal', 'meals', 'meal kit', 'lunch', 'dinner',
    'breakfast', 'brunch', 'takeaway', 'take away', 'takeout', 'food delivery', 'pizza',
    'pizzeria', 'burger', 'burgers', 'sushi', 'ramen', 'noodles', 'taco', 'tacos',
    'kebab', 'shawarma', 'falafel', 'bbq', 'barbecue', 'steakhouse', 'grill', 'bar',
    'snack', 'snacks', 'sandwich', 'sandwiches', 'bagel', 'bagels', 'donut', 'donuts',
    'doughnut', 'doughnuts', 'ice cream', 'bubble tea', 'tea room', 'tea house',
    'pastry', 'drive thru',
    // French
    'supermarché', 'hypermarché', 'supérette', 'épicerie', 'alimentation',
    'boulangerie', 'pâtisserie', 'boucherie', 'charcuterie', 'fromagerie', 'primeur',
    'traiteur', 'crêperie', 'resto', 'restauration', 'cantine', 'repas', 'déjeuner',
    'petit déjeuner', 'dîner', 'salon de thé', 'livraison repas',
    // Arabic
    'مطعم', 'مطاعم', 'مقهى', 'مقاهي', 'كافيه', 'قهوة', 'شاي', 'عصير', 'سوبرماركت',
    'سوبر ماركت', 'بقالة', 'مخبزة', 'مخبز', 'حلويات', 'جزار', 'جزارة', 'لحوم', 'خضار',
    'فواكه', 'أكل', 'طعام', 'وجبة', 'وجبات', 'غداء', 'عشاء', 'فطور', 'إفطار', 'بيتزا',
    'برغر', 'شاورما', 'سناك',
    // Chinese
    '餐厅', '餐馆', '餐饮', '饭馆', '食堂', '小吃', '快餐', '外卖', '超市', '便利店',
    '菜市场', '咖啡', '奶茶', '茶饮', '早餐', '午餐', '晚餐', '早饭', '午饭', '晚饭',
    '吃饭', '夜宵', '火锅', '烧烤', '面馆', '面包', '蛋糕', '水果', '蔬菜', '零食',
    '全家桶',
  ],
  Transport: [
    // English
    'taxi', 'taxis', 'rideshare', 'ride share', 'fuel', 'petrol', 'diesel', 'gasoline',
    'gas station', 'petrol station', 'filling station', 'service station', 'parking',
    'car park', 'toll', 'tolls', 'tollway', 'metro', 'bus', 'buses', 'bus fare', 'train',
    'trains', 'railway', 'rail', 'tram', 'tramway', 'ferry', 'airline', 'airlines',
    'airport', 'flight', 'flights', 'airfare', 'car wash', 'car rental', 'car hire',
    'rental car', 'transit', 'public transport', 'commute', 'ev charging',
    'charging station', 'bike share', 'car insurance', 'auto insurance',
    'motor insurance', 'car repair', 'auto repair', 'mechanic', 'oil change', 'tyres',
    'vehicle', 'subway fare', 'subway ride', 'subway ticket', 'subway station',
    // French
    'carburant', 'gazole', 'gasoil', 'station service', 'station essence',
    'station de lavage', 'lavage auto', 'péage', 'autoroute', 'stationnement',
    'billet de train', 'autobus', 'autocar', 'navette', 'avion', "billet d'avion",
    'aéroport', 'covoiturage', 'location voiture', 'location de voiture',
    'petit taxi', 'grand taxi',
    // Arabic
    'تاكسي', 'طاكسي', 'سيارة أجرة', 'بنزين', 'وقود', 'ديزل', 'مازوت', 'محطة وقود',
    'محطة بنزين', 'حافلة', 'طوبيس', 'أتوبيس', 'ترامواي', 'طرامواي', 'قطار', 'مترو',
    'طائرة', 'طيران', 'مطار', 'موقف سيارات', 'باركينغ', 'كراء سيارة', 'غسيل سيارات',
    'طريق سيار', 'الطريق السيار',
    // Chinese
    '地铁', '公交', '巴士', '出租车', '打车', '网约车', '快车', '专车', '出行', '高铁',
    '火车', '动车', '铁路', '机票', '航空', '航班', '机场', '船票', '轮渡', '停车',
    '加油', '加油站', '汽油', '柴油', '油费', '过路费', '高速费', '交通卡', '共享单车',
    '单车', '洗车', '租车', '充电桩', '充电站',
  ],
  Gym: [
    // English
    'gym', 'gyms', 'fitness', 'yoga', 'pilates', 'workout', 'personal trainer',
    'personal training', 'spin class', 'bouldering', 'martial arts',
    'swimming pool', 'health club', 'athletic club', 'leisure centre', 'boxing club',
    // French
    'salle de sport', 'musculation', 'piscine', 'coach sportif', 'club de sport',
    // Arabic
    'جيم', 'نادي رياضي', 'صالة رياضية', 'قاعة رياضية', 'لياقة بدنية', 'يوغا',
    'كمال الأجسام', 'مسبح',
    // Chinese
    '健身', '瑜伽', '普拉提', '私教', '游泳馆', '拳馆',
  ],
  Shopping: [
    // English
    'shopping', 'clothing', 'clothes', 'apparel', 'fashion', 'shoes', 'shoe store',
    'footwear', 'boutique', 'electronics', 'furniture', 'homeware', 'department store',
    'retail', 'mall', 'outlet', 'hardware store', 'home improvement', 'bookstore',
    'bookshop', 'toys', 'toy store', 'jewelry', 'jewellery', 'cosmetics', 'gift shop',
    'stationery', 'online shopping', 'marketplace',
    // French
    'vêtements', 'chaussures', 'habillement', 'prêt à porter', 'centre commercial',
    'électroménager', 'meubles', 'ameublement', 'bricolage', 'quincaillerie',
    'librairie', 'jouets', 'parfumerie', 'bijouterie', 'maroquinerie',
    'achats en ligne',
    // Arabic
    'ملابس', 'أحذية', 'حذاء', 'تسوق', 'مركز تجاري', 'إلكترونيات', 'أثاث',
    'أجهزة منزلية', 'عطور', 'مجوهرات', 'قيسارية',
    // Chinese
    '购物', '商场', '商城', '网购', '服装', '服饰', '衣服', '鞋子', '鞋店', '数码',
    '电器', '家电', '家具', '百货', '化妆品', '美妆', '珠宝', '玩具', '书店', '文具',
    '日用品', '五金',
  ],
  Subscriptions: [
    // English
    'streaming', 'software', 'saas', 'cloud storage', 'mobile plan', 'phone plan',
    'phone bill', 'broadband',
    // French
    'forfait mobile', 'box internet',
    // Chinese
    '视频会员', '音乐会员', '话费', '宽带', '流量包',
  ],
};

/**
 * Words that say how the money left rather than what it bought. They mean
 * Subscriptions when nothing else is recognised, and lose to everything that
 * is — see rule 3 above.
 */
const RECURRING_WORDS: readonly string[] = [
  'subscription', 'subscriptions', 'membership', 'membership fee', 'auto renewal',
  'auto renew', 'abonnement', 'abonnements', 'renouvellement automatique',
  'اشتراك', 'اشتراكات', 'اشتراك شهري', 'تجديد تلقائي',
  '订阅', '自动续费', '连续包月', '连续包年', '会员费',
];

/**
 * Phrases that contain a keyword but mean something else. A keyword inside one
 * of these is not a match; the phrase itself names no category.
 */
const NOT_KEYWORDS: readonly string[] = [
  // Streets with shops on them, not JD.com.
  '南京东', '北京东',
  // A family photo (全家 is FamilyMart), a minivan (面包 is bread), a mobile
  // data top-up (加油 is refuelling).
  '全家福', '面包车', '加油包',
  'toll free',
];

// ── Brands that trade under one name everywhere ──────────────────────────────

const GLOBAL_BRANDS: Lexicon = {
  Food: [
    'starbucks', 'mcdonald', 'mcdonalds', 'mcdo', 'macdo', 'kfc', 'burger king',
    'subway', 'dominos', 'domino s', 'pizza hut', 'papa johns', 'papa john s',
    'uber eats', 'ubereats', 'amazon fresh', 'costa coffee', 'tim hortons', 'dunkin',
    'krispy kreme', 'five guys', '7 eleven', 'seven eleven', 'whole foods', 'carrefour',
    'carrefour market', 'carrefour express', 'carrefour city', 'lidl', 'aldi',
    'hellofresh', 'too good to go',
    'ماكدونالدز', 'كنتاكي', 'ستاربكس', 'كارفور',
  ],
  Transport: [
    'uber', 'shell', 'bp', 'esso', 'totalenergies', 'total energies', 'circle k',
    'ryanair', 'easyjet', 'air france', 'lufthansa', 'klm', 'british airways',
    'emirates airline', 'qatar airways', 'turkish airlines', 'royal air maroc',
    'air arabia', 'iberia', 'vueling', 'transavia', 'eurostar', 'flixbus', 'blablacar',
    'indrive', 'heetch', 'careem', 'free now', 'freenow', 'bolt eu', 'europcar',
    'sixt', 'hertz', 'avis budget', 'enterprise rent',
    'أوبر',
  ],
  Shopping: [
    'amazon', 'amzn', 'amazon mktp', 'ebay', 'etsy', 'aliexpress', 'temu', 'shein',
    'ikea', 'zara', 'h and m', 'uniqlo', 'nike', 'adidas', 'primark', 'decathlon',
    'sephora', 'apple store', 'bershka', 'pull and bear', 'massimo dutti',
    'lc waikiki', 'defacto', 'costco',
    'أمازون',
  ],
  Subscriptions: [
    'netflix', 'spotify', 'apple music', 'apple tv', 'apple tv plus', 'apple one',
    'apple com bill', 'itunes', 'youtube', 'youtube premium', 'disney plus',
    'disneyplus', 'hbo', 'hbo max', 'amazon prime', 'prime video', 'amazon music',
    'amazon web services', 'aws', 'audible', 'adobe', 'microsoft', 'microsoft 365',
    'office 365', 'xbox game pass', 'playstation plus', 'dropbox', 'icloud',
    'google one', 'google storage', 'chatgpt', 'openai', 'linkedin premium',
    'duolingo', 'deezer', 'canva', 'github', 'patreon', 'dazn', 'paramount plus',
    'crunchyroll', 'starzplay', 'anghami', 'vodafone', 'uber one',
    'نتفليكس',
  ],
  Gym: [
    'anytime fitness', 'crossfit', 'peloton', 'golds gym', 'gold s gym',
    'fitness first', 'snap fitness', 'virgin active',
  ],
};

// ── Regional lists, chosen by currency ───────────────────────────────────────

type RegionId = 'us' | 'eu' | 'uk' | 'ma' | 'cn';

interface Region {
  /** Local vocabulary that is ambiguous elsewhere ("gas" is fuel only in America). */
  words?: Lexicon;
  brands: Lexicon;
  /** Local words for "subscription": Subscriptions, but last, as RECURRING_WORDS. */
  recurring?: readonly string[];
  /** Local phrases that contain a keyword but mean something else. */
  not?: readonly string[];
}

const REGIONS: Record<RegionId, Region> = {
  // United States and Canada (USD, CAD).
  us: {
    // A Canadian filling station is a "gas bar", which is not a bar.
    words: { Transport: ['gas', 'gas bar'] },
    // Gas the utility, billed monthly, is not gas the fuel.
    not: [
      'natural gas', 'gas company', 'gas bill', 'gas utility', 'gas service',
      'gas and electric', 'gas electric', 'southwest gas', 'peoples gas',
      'washington gas', 'nicor gas', 'national fuel gas', 'spire gas',
      // A hospital network, not the cable company.
      'spectrum health',
    ],
    brands: {
      Food: [
        'kroger', 'safeway', 'trader joe', 'trader joes', 'walmart',
        'publix', 'wegmans', 'albertsons', 'food lion', 'meijer', 'heb', 'h e b',
        'giant eagle', 'stop and shop', 'harris teeter', 'sprouts', 'winco', 'vons',
        'ralphs', 'hy vee', 'piggly wiggly', 'doordash', 'grubhub', 'postmates',
        'instacart', 'seamless', 'chipotle', 'wendys', 'wendy s', 'taco bell',
        'chick fil a', 'panera', 'in n out', 'arbys', 'arby s', 'popeyes',
        'jack in the box', 'dairy queen', 'shake shack', 'panda express',
        'olive garden', 'applebees', 'applebee s', 'ihop', 'dennys', 'denny s',
        'cheesecake factory', 'wawa', 'sheetz', 'loblaws', 'sobeys', 'no frills',
        'save on foods', 'real canadian superstore',
      ],
      Transport: [
        'chevron', 'exxon', 'exxonmobil', 'mobil', 'sunoco', 'valero', 'citgo', 'arco',
        'phillips 66', 'conoco', 'racetrac', 'quiktrip', 'kwik trip', 'pilot flying j',
        'lyft', 'amtrak', 'mta', 'nyct', 'metrocard', 'ezpass', 'e zpass', 'sunpass',
        'fastrak', 'dmv', 'american airlines', 'delta air', 'delta airlines',
        'delta air lines', 'united airlines', 'southwest airlines', 'jetblue',
        'alaska airlines', 'spirit airlines', 'frontier airlines', 'air canada',
        'westjet', 'petro canada', 'irving oil', 'via rail', 'parkmobile', 'spothero',
        'jiffy lube', 'autozone', 'pep boys', 'zipcar', 'turo',
      ],
      Shopping: [
        'target', 'best buy', 'nordstrom', 'macys', 'macy s', 'kohls', 'kohl s',
        'ross stores', 'ross dress for less', 'tj maxx', 'tjmaxx', 'marshalls',
        'homegoods', 'home depot', 'lowes', 'lowe s', 'dollar tree', 'dollar general',
        'old navy', 'bed bath', 'wayfair', 'sams club', 'sam s club', 'office depot',
        'barnes and noble', 'gamestop', 'ulta', 'petsmart', 'petco', 'canadian tire',
        'hudson s bay', 'dollarama',
      ],
      Subscriptions: [
        'hulu', 'sling tv', 'peacock tv', 'peacocktv', 'youtube tv', 'sirius xm',
        'siriusxm', 'verizon', 't mobile', 'tmobile', 'metro by t mobile', 'att',
        'at and t', 'comcast', 'xfinity', 'spectrum', 'cox communications',
        'cricket wireless', 'boost mobile', 'mint mobile', 'google fi', 'bell canada',
        'telus',
      ],
      Gym: [
        'planet fitness', 'la fitness', 'equinox', 'orangetheory', 'orange theory',
        '24 hour fitness', 'lifetime fitness', 'life time fitness', 'ymca', 'soulcycle',
        'f45', 'crunch fitness', 'goodlife fitness', 'blink fitness',
      ],
    },
  },

  // The euro area: France, Spain, Germany, Italy, Belgium, the Netherlands,
  // Luxembourg. Statements there are in the local language, so the plain words
  // a French list misses travel with the region.
  eu: {
    words: {
      Food: [
        'supermarkt', 'supermercado', 'supermercato', 'bäckerei', 'baeckerei',
        'bakkerij', 'panadería', 'panetteria', 'restaurante', 'ristorante', 'trattoria',
        'osteria', 'gaststätte', 'gaststaette', 'gasthaus', 'imbiss', 'metzgerei', 'carnicería',
        'macelleria', 'lebensmittel', 'alimentari', 'cervecería',
      ],
      Transport: [
        'tankstelle', 'gasolinera', 'benzina', 'carburante', 'parkhaus', 'parkplatz',
        'aparcamiento', 'parcheggio', 'fahrkarte', 'peaje', 'pedaggio', 'treno',
        'flughafen', 'aeropuerto', 'aeroporto',
      ],
      Gym: ['fitnessstudio', 'gimnasio', 'palestra', 'sportschool'],
      Shopping: [
        'kleidung', 'zapatos', 'scarpe', 'abbigliamento', 'kaufhaus', 'möbel', 'moebel',
        'muebles',
      ],
    },
    recurring: ['abo', 'suscripción', 'abbonamento'],
    // Net pay on a payslip transfer, not the Netto supermarket.
    not: ['gehalt netto', 'lohn netto', 'netto gehalt', 'netto lohn'],
    brands: {
      Food: [
        'leclerc', 'e leclerc', 'auchan', 'intermarché', 'super u', 'hyper u',
        'systeme u', 'u express', 'marche u', 'geant casino', 'casino supermarche',
        'petit casino', 'casino shop', 'monoprix', 'monop', 'franprix', 'picard',
        'grand frais', 'biocoop', 'netto', 'leader price', 'colruyt',
        'delhaize', 'albert heijn', 'jumbo supermarkten', 'rewe', 'edeka', 'kaufland',
        'penny markt', 'mercadona', 'eroski', 'esselunga', 'conad', 'coop', 'spar',
        // The cash-and-carry wholesaler, not the underground.
        'metro cash and carry', 'metro cash carry',
        'lieferando', 'thuisbezorgd', 'just eat', 'deliveroo', 'glovo',
        'brioche dorée', 'la mie câline', 'columbus café', 'flunch', 'buffalo grill',
        'courtepaille', 'nordsee', 'vapiano', 'telepizza',
      ],
      Transport: [
        'sncf', 'sncf connect', 'ratp', 'tgv', 'ouigo', 'tgv inoui', 'transilien',
        'navigo', 'renfe', 'deutsche bahn', 'db vertrieb', 'db fernverkehr', 'bahncard', 'bvg',
        'trenitalia', 'italo treno', 'sncb', 'nmbs', 'ns reizigers', 'gvb', 'stib',
        'keolis', 'transdev', 'vinci autoroutes', 'vinci park', 'sanef', 'aprr',
        'cofiroute', 'indigo parking', 'effia', 'saemes', 'total access', 'agip',
        'aral', 'repsol', 'cepsa', 'q8', 'galp', 'vélib', 'cabify', 'g7', 'getaround',
        'alsa',
      ],
      Shopping: [
        'fnac', 'darty', 'leroy merlin', 'castorama', 'bricomarché', 'brico dépôt',
        'kiabi', 'la redoute', 'cdiscount', 'vinted', 'zalando', 'galeries lafayette',
        'el corte inglés', 'mediamarkt', 'media markt', 'hema', 'bol com', 'coolblue',
        'gifi', 'maisons du monde', 'conforama', 'jysk', 'c and a', 'celio', 'promod',
        'nocibé', 'yves rocher', 'intersport', 'go sport', 'rossmann',
      ],
      Subscriptions: [
        'canal plus', 'sfr', 'bouygues telecom', 'free mobile', 'freebox',
        'orange sa', 'orange france', 'sosh', 'red by sfr', 'molotov',
        'deutsche telekom', 'telekom', 'movistar', 'jazztel', 'wind tre', 'iliad',
        'fastweb', 'proximus', 'telenet', 'kpn', 'ziggo',
      ],
      Gym: [
        'basic fit', 'basicfit', 'fitness park', 'keep cool', "l'orange bleue",
        'neoness', 'on air fitness', 'mcfit', 'urban sports club', 'clever fit',
        'fit for free', 'altafit',
      ],
    },
  },

  // The United Kingdom (GBP).
  uk: {
    words: { Food: ['pub', 'chippy', 'off licence'] },
    not: ['metro bank'],
    brands: {
      Food: [
        'tesco', 'tesco express', 'tesco extra', 'tesco metro', 'sainsburys',
        'sainsbury s', 'sainsbury', 'asda', 'morrisons', 'waitrose', 'co op food',
        'coop food', 'iceland', 'm and s food', 'm and s simply food', 'ocado', 'greggs',
        'pret', 'pret a manger', 'costa', 'caffe nero', 'nandos', 'nando s', 'wagamama',
        'pizza express', 'just eat', 'deliveroo', 'itsu', 'farmfoods', 'spar',
      ],
      Transport: [
        'tfl', 'trainline', 'national rail', 'lner', 'gwr', 'avanti west coast',
        'thameslink', 'southeastern', 'scotrail', 'northern rail', 'transpennine',
        'national express', 'stagecoach', 'first bus', 'arriva', 'addison lee',
        'tesco pfs', 'texaco', 'ncp', 'ringgo', 'paybyphone', 'justpark', 'dvla',
        'congestion charge', 'dart charge', 'ulez', 'jet2', 'virgin atlantic',
      ],
      Shopping: [
        'argos', 'boots', 'john lewis', 'currys', 'tk maxx', 'asos', 'wickes',
        'screwfix', 'matalan', 'sports direct', 'jd sports', 'superdrug', 'wilko',
        'home bargains', 'b and q', 'b and m', 'marks and spencer', 'm and s',
        'debenhams', 'selfridges', 'harrods', 'hobbycraft', 'dunelm', 'river island',
        'new look', 'waterstones', 'whsmith', 'wh smith', 'card factory', 'poundland',
      ],
      Subscriptions: [
        'sky digital', 'sky uk', 'sky tv', 'sky broadband', 'sky mobile', 'now tv',
        'bt group', 'bt broadband', 'bt mobile', 'virgin media', 'ee limited',
        'o2 uk', 'telefonica uk', 'giffgaff', 'three uk', 'tv licence', 'britbox',
        'tesco mobile', 'plusnet', 'talktalk', 'voxi',
      ],
      Gym: [
        'puregym', 'pure gym', 'the gym group', 'david lloyd', 'everyone active',
        'better leisure', 'jd gyms', 'bannatyne',
      ],
    },
  },

  // Morocco (MAD).
  ma: {
    words: { Food: ['hanout', 'حانوت'] },
    brands: {
      Food: [
        'marjane', 'marjane market', 'label vie', 'labelvie', 'bim', 'acima',
        'aswak assalam', 'aswak salam', 'atacadao', 'glovo', 'jumia food',
        'مرجان', 'أسواق السلام',
      ],
      Transport: [
        'afriquia', 'afriquia smdc', 'total maroc', 'petrom', 'winxo', 'ziz',
        'ola energy', 'oilibya', 'oncf', 'al boraq', 'alboraq', 'ctm', 'supratours',
        'alsa', 'casa tramway', 'casatram', 'busway', 'adm', 'autoroutes du maroc',
        'yango',
        'البراق',
      ],
      Shopping: [
        'jumia', 'kitea', 'electroplanet', 'bricoma', 'mr bricolage', 'biougnach',
        'virgin megastore', 'morocco mall', 'anfaplace',
      ],
      Subscriptions: [
        'inwi', 'iam', 'maroc telecom', 'itissalat al maghrib', 'orange maroc',
        'shahid vip',
        'اتصالات المغرب', 'إنوي',
      ],
      Gym: ['city club', 'fitness park'],
    },
  },

  // Mainland China (CNY, CNH) — and any description written in Chinese.
  cn: {
    // 物美 (Wumart) inside "good value for money".
    not: ['物美价廉'],
    brands: {
      Food: [
        '美团', '美团外卖', '美团优选', '饿了么', '盒马', '永辉', '沃尔玛', '家乐福',
        '大润发', '物美', '华润万家', '罗森', '全家', '便利蜂', '美宜佳', '星巴克',
        '瑞幸', '喜茶', '奈雪', '蜜雪冰城', '茶百道', '古茗', '麦当劳', '肯德基',
        '必胜客', '汉堡王', '赛百味', '达美乐', '海底捞', '西贝', '叮咚买菜', '朴朴',
        '多多买菜', '山姆会员店',
        'meituan', 'ele me', 'luckin', 'heytea',
      ],
      Transport: [
        '滴滴', '曹操出行', '高德打车', '美团打车', '美团单车', '哈啰', '青桔', '摩拜',
        '中国石化', '中石化', '中国石油', '中石油', '壳牌',
        'didi', '12306',
      ],
      Shopping: [
        '淘宝', '天猫', '京东', '拼多多', '唯品会', '苏宁', '闲鱼', '优衣库', '宜家',
        '无印良品', '名创优品', '屈臣氏',
        'taobao', 'tmall', 'jd com', 'jingdong', 'pinduoduo',
      ],
      Subscriptions: [
        '爱奇艺', '优酷', '腾讯视频', '芒果tv', '哔哩哔哩', '大会员', '网易云音乐',
        'qq音乐', '酷狗', '百度网盘', '中国移动', '中国联通', '中国电信',
        'iqiyi', 'bilibili', 'youku',
      ],
      Gym: ['乐刻', '超级猩猩'],
    },
  },
};

const REGION_BY_CURRENCY: Readonly<Record<string, RegionId>> = {
  USD: 'us',
  CAD: 'us',
  EUR: 'eu',
  GBP: 'uk',
  MAD: 'ma',
  CNY: 'cn',
  // The offshore yuan is the same money in the same shops.
  CNH: 'cn',
};

// ── Normalisation ────────────────────────────────────────────────────────────

const CJK_CHAR = '\\u2E80-\\u2FFF\\u3005-\\u3007\\u3040-\\u30FF\\u3100-\\u312F\\u31F0-\\u31FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uAC00-\\uD7AF';
const HAS_CJK = new RegExp(`[${CJK_CHAR}]`);
const HAS_HAN = /[㐀-䶿一-鿿豈-﫿]/;
const HAS_ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿ]/;
const CJK_THEN_OTHER = new RegExp(`([${CJK_CHAR}])(?=[^${CJK_CHAR}\\s])`, 'g');
const OTHER_THEN_CJK = new RegExp(`([^${CJK_CHAR}\\s])(?=[${CJK_CHAR}])`, 'g');
const SPACE_INSIDE_CJK = new RegExp(`([${CJK_CHAR}]) (?=[${CJK_CHAR}])`, 'g');

/**
 * The form both descriptions and keywords are compared in: lower case, no
 * accents or Arabic diacritics, words separated by single spaces — with a
 * boundary wherever letters meet digits or Chinese meets anything else, and
 * no spaces at all inside a run of Chinese.
 *
 * "McDonald's" is "mcdonald s", "H&M" is "h and m", "Disney+" is
 * "disney plus", "CARREFOUR123" is "carrefour 123", "Netflix会员" is
 * "netflix 会员", "淘宝 订单" is "淘宝订单".
 */
export function normaliseForMatching(text: string): string {
  let s = String(text ?? '');
  try {
    // NFKD also folds full-width Latin (ＮＥＴＦＬＩＸ) and Arabic presentation forms.
    s = s.normalize('NFKD');
  } catch {
    // An engine without normalize keeps the accents; matching still works on
    // anything typed without them.
  }
  return s
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ـ/g, '') // Arabic tatweel, a stretching stroke with no meaning
    .replace(/ة/g, 'ه') // ة and ه are written interchangeably at a word's end
    .replace(/ى/g, 'ي') // and so are ى and ي
    .replace(/['’ʼ`]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/(\p{L})(?=\p{N})/gu, '$1 ')
    .replace(/(\p{N})(?=\p{L})/gu, '$1 ')
    .replace(CJK_THEN_OTHER, '$1 ')
    .replace(OTHER_THEN_CJK, '$1 ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(SPACE_INSIDE_CJK, '$1');
}

// ── The compiled table ───────────────────────────────────────────────────────

type Kind = 'latin' | 'arabic' | 'cjk';

/** Rule 2 and 3 above: lower wins. */
const WORD = 0;
const BRAND = 1;
const RECURRING = 2;
type Tier = typeof WORD | typeof BRAND | typeof RECURRING;

interface Entry {
  keyword: string;
  /** Null for a phrase that only exists to swallow the keywords inside it. */
  category: KeywordCategory | null;
  tier: Tier;
  kind: Kind;
  /** Arabic only: the keyword behind its optional attached particles. */
  pattern?: RegExp;
}

/** و / ف, then ب / ل / ك, then the article — المطعم, بالمطعم, للمطعم, والمطعم. */
const ARABIC_PROCLITICS = '(?:[\\u0648\\u0641])?(?:\\u0628\\u0627\\u0644|\\u0643\\u0627\\u0644|\\u0644\\u0644|\\u0627\\u0644|[\\u0628\\u0644\\u0643])?';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function entry(raw: string, category: KeywordCategory | null, tier: Tier): Entry | null {
  const keyword = normaliseForMatching(raw);
  if (!keyword) return null;
  if (HAS_CJK.test(keyword)) return { keyword, category, tier, kind: 'cjk' };
  if (HAS_ARABIC.test(keyword)) {
    const pattern = new RegExp(` ${ARABIC_PROCLITICS}${escapeRegExp(keyword)}(?= )`, 'g');
    return { keyword, category, tier, kind: 'arabic', pattern };
  }
  return { keyword, category, tier, kind: 'latin' };
}

function compile(lexicon: Lexicon, tier: Tier): Entry[] {
  const entries: Entry[] = [];
  for (const [category, keywords] of Object.entries(lexicon) as [KeywordCategory, readonly string[]][]) {
    for (const raw of keywords) {
      const e = entry(raw, category, tier);
      if (e) entries.push(e);
    }
  }
  return entries;
}

function compileList(keywords: readonly string[], category: KeywordCategory | null, tier: Tier): Entry[] {
  return keywords.map((raw) => entry(raw, category, tier)).filter((e): e is Entry => e !== null);
}

let baseEntries: Entry[] | null = null;
const regionEntries = new Map<RegionId, Entry[]>();

function entriesFor(region: RegionId | null): Entry[] {
  if (region === null) {
    baseEntries ??= [
      ...compile(WORDS, WORD),
      ...compile(GLOBAL_BRANDS, BRAND),
      ...compileList(RECURRING_WORDS, 'Subscriptions', RECURRING),
      ...compileList(NOT_KEYWORDS, null, WORD),
    ];
    return baseEntries;
  }
  let entries = regionEntries.get(region);
  if (!entries) {
    const { words, brands, recurring, not } = REGIONS[region];
    entries = [
      ...(words ? compile(words, WORD) : []),
      ...compile(brands, BRAND),
      ...(recurring ? compileList(recurring, 'Subscriptions', RECURRING) : []),
      ...(not ? compileList(not, null, WORD) : []),
    ];
    regionEntries.set(region, entries);
  }
  return entries;
}

/** The region a currency selects, or null for a currency with no list of its own. */
export function regionForCurrency(currency?: string | null): RegionId | null {
  const code = String(currency ?? '').trim().toUpperCase();
  return REGION_BY_CURRENCY[code] ?? null;
}

// ── Matching ─────────────────────────────────────────────────────────────────

interface Hit {
  start: number;
  end: number;
  category: KeywordCategory | null;
  tier: Tier;
}

/** Every place `entry` occurs in `padded` (the normalised text with a space at each end). */
function collect(entry: Entry, padded: string, hits: Hit[]): void {
  const { keyword, category, tier } = entry;
  if (entry.kind === 'latin') {
    const needle = ` ${keyword} `;
    for (let i = padded.indexOf(needle); i !== -1; i = padded.indexOf(needle, i + 1)) {
      hits.push({ start: i + 1, end: i + 1 + keyword.length, category, tier });
    }
    return;
  }
  if (entry.kind === 'arabic') {
    for (const m of padded.matchAll(entry.pattern!)) {
      hits.push({ start: m.index! + 1, end: m.index! + m[0].length, category, tier });
    }
    return;
  }
  for (let i = padded.indexOf(keyword); i !== -1; i = padded.indexOf(keyword, i + 1)) {
    hits.push({ start: i, end: i + keyword.length, category, tier });
  }
}

function choose(hits: Hit[]): KeywordCategory | null {
  let best: Hit | null = null;
  for (const hit of hits) {
    // A "means something else" phrase is never an answer; it only swallows.
    if (hit.category === null) continue;
    const length = hit.end - hit.start;
    // Rule 1: a match inside a longer match is part of that match.
    const swallowed = hits.some(
      (other) =>
        other !== hit &&
        other.start <= hit.start &&
        hit.end <= other.end &&
        other.end - other.start > length,
    );
    if (swallowed) continue;
    if (
      !best ||
      // Rules 2 and 3: words, then brands, then how-it-was-paid words.
      hit.tier < best.tier ||
      // Rule 4: then the leftmost, then the longer.
      (hit.tier === best.tier &&
        (hit.start < best.start ||
          (hit.start === best.start && length > best.end - best.start)))
    ) {
      best = hit;
    }
  }
  return best?.category ?? null;
}

function matchIn(text: string, regions: readonly (RegionId | null)[]): KeywordCategory | null {
  if (!text) return null;
  const padded = ` ${text} `;
  const hits: Hit[] = [];
  for (const region of regions) {
    for (const entry of entriesFor(region)) collect(entry, padded, hits);
  }
  return choose(hits);
}

/** The lists that apply to this description in this currency. */
function regionsFor(text: string, currency?: string | null): (RegionId | null)[] {
  const regions: (RegionId | null)[] = [null];
  const byCurrency = regionForCurrency(currency);
  if (byCurrency) regions.push(byCurrency);
  if (byCurrency !== 'cn' && HAS_HAN.test(text)) regions.push('cn');
  return regions;
}

/**
 * The built-in category a description most likely belongs to, or null when
 * nothing in it is recognised (the caller then uses its own default, "Other").
 *
 * `currency` is the user's currency (or the transaction's): it decides which
 * regional brand list applies. Without one, only plain words and global brands
 * are used.
 */
export function fallbackCategory(
  description: string,
  currency?: string | null,
): KeywordCategory | null {
  const text = normaliseForMatching(description);
  return matchIn(text, regionsFor(text, currency));
}

// ── Plain keyword lists for other heuristics ─────────────────────────────────

const compiledLists = new WeakMap<readonly string[], Entry[]>();

function compiledList(keywords: readonly string[], category: KeywordCategory | null): Entry[] {
  let entries = compiledLists.get(keywords);
  if (!entries) {
    entries = compileList(keywords, category, WORD);
    compiledLists.set(keywords, entries);
  }
  return entries;
}

/**
 * Whether a description mentions any of `keywords`, under the same rules as
 * the fallback: whole words for Latin and Arabic, substrings for Chinese, case
 * and accents ignored, and nothing inside one of the longer `notPhrases`
 * ("sale" is not in "point of sale"). For heuristics that need a yes/no rather
 * than a category, such as the impulse guess. Pass module-level arrays: each
 * list is compiled once and remembered by identity.
 */
export function mentionsAny(
  description: string,
  keywords: readonly string[],
  notPhrases: readonly string[] = [],
): boolean {
  const text = normaliseForMatching(description);
  if (!text) return false;
  const padded = ` ${text} `;
  const hits: Hit[] = [];
  // The category only marks a hit as a keyword rather than a "not" phrase.
  for (const entry of compiledList(keywords, 'Food')) collect(entry, padded, hits);
  if (hits.length === 0) return false;
  for (const entry of compiledList(notPhrases, null)) collect(entry, padded, hits);
  return choose(hits) !== null;
}

/**
 * Every keyword the fallback can use for a currency (all regions when
 * `currency` is "*"), normalised, with its category — null for a phrase that
 * only cancels the keywords inside it — and its kind. For tests that check the
 * table itself; not needed at runtime.
 */
export function fallbackKeywords(
  currency?: string | null,
): readonly { keyword: string; category: KeywordCategory | null; kind: 'word' | 'brand' | 'recurring' }[] {
  const regions: (RegionId | null)[] =
    currency === '*'
      ? [null, ...(Object.keys(REGIONS) as RegionId[])]
      : [null, ...[regionForCurrency(currency)].filter((r): r is RegionId => r !== null)];
  const kinds = ['word', 'brand', 'recurring'] as const;
  return regions.flatMap((r) =>
    entriesFor(r).map(({ keyword, category, tier }) => ({ keyword, category, kind: kinds[tier] })),
  );
}
