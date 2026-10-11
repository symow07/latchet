import Svg, { Path } from 'react-native-svg';
import type { StyleProp, ViewStyle } from 'react-native';
import { ICON_PATHS, ICON_PATHS_BAR, ICON_PATHS_LINE, type IconArt } from '@/lib/icon-paths';
import { LIGHT } from '@/lib/identity/tokens';

/**
 * The app's icons.
 *
 * Drawn from path data committed in lib/icon-paths.ts, not from an icon
 * package — see scripts/generate-icons.mjs for how that file is produced and
 * why. Nothing is fetched at runtime and no font is loaded.
 *
 * The set is Hugeicons stroke rounded, the design identity's reference: every
 * glyph a single-weight outline with round caps and joins, never filled.
 *
 * The exported names are the ones the app has always used, so the call sites
 * across every screen are untouched by the change of icon set. Swapping a
 * single glyph is one line in the generator.
 */
export interface IconProps {
  size?: number;
  color?: string;
  /**
   * Ignored. Every glyph draws at the set's own weight (see `stroke` below),
   * so the identity holds one weight everywhere. Call sites still pass
   * `S.stroke` from when weight was set per call; it stays so they compile.
   */
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * All artwork is drawn on a 24×24 grid, which is what the source set uses.
 * `size` is the rendered box; the viewBox does the scaling.
 */
const GRID = 24;

/** The thinnest a glyph's stroke may render, in points, at any size. */
export const MIN_ICON_STROKE_PT = 1.1;

/**
 * A path's stroke in viewBox units at `size`: the set's own weight, held at
 * MIN_ICON_STROKE_PT so an 18pt glyph does not go hairline beside its
 * neighbours.
 */
export function iconStroke(stroke: number, size: number): number {
  return Math.max(stroke, (MIN_ICON_STROKE_PT * GRID) / size);
}

/** The identity's ink, so an icon with no colour passed is never pure black. */
const DEFAULT_INK = LIGHT.ink;

function draw(art: IconArt, label: string) {
  function Icon({ size = 24, color = DEFAULT_INK, style }: IconProps) {
    return (
      <Svg width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`} style={style}>
        {art.paths.map((p, i) =>
          // A stroked path and a filled one need opposite props. The outline
          // artwork is `fill="none"` with a stroke; painting it as a fill turns
          // the glyph into unrecognisable blobs. Caps and joins default to
          // round: the identity draws nothing with a square end or corner.
          p.stroke ? (
            <Path
              key={i}
              d={p.d}
              fill="none"
              stroke={color}
              strokeWidth={iconStroke(p.stroke, size)}
              strokeLinecap={p.cap ?? 'round'}
              strokeLinejoin={p.join ?? 'round'}
              opacity={p.opacity}
            />
          ) : (
            <Path key={i} d={p.d} fill={color} fillRule={p.fillRule} opacity={p.opacity} />
          )
        )}
      </Svg>
    );
  }
  Icon.displayName = label;
  return Icon;
}

export const Activity = draw(ICON_PATHS.Activity, 'Activity');
export const AlertCircle = draw(ICON_PATHS.AlertCircle, 'AlertCircle');
export const AlertTriangle = draw(ICON_PATHS.AlertTriangle, 'AlertTriangle');
export const ArrowDownLeft = draw(ICON_PATHS.ArrowDownLeft, 'ArrowDownLeft');
export const ArrowUpRight = draw(ICON_PATHS.ArrowUpRight, 'ArrowUpRight');
export const Award = draw(ICON_PATHS.Award, 'Award');
export const Bell = draw(ICON_PATHS.Bell, 'Bell');
export const Briefcase = draw(ICON_PATHS.Briefcase, 'Briefcase');
export const Building2 = draw(ICON_PATHS.Building2, 'Building2');
export const Calendar = draw(ICON_PATHS.Calendar, 'Calendar');
export const Camera = draw(ICON_PATHS.Camera, 'Camera');
export const Check = draw(ICON_PATHS.Check, 'Check');
export const CheckCheck = draw(ICON_PATHS.CheckCheck, 'CheckCheck');
export const ChevronDown = draw(ICON_PATHS.ChevronDown, 'ChevronDown');
export const ChevronLeft = draw(ICON_PATHS.ChevronLeft, 'ChevronLeft');
export const ChevronRight = draw(ICON_PATHS.ChevronRight, 'ChevronRight');
export const ChevronUp = draw(ICON_PATHS.ChevronUp, 'ChevronUp');
export const ClipboardCheck = draw(ICON_PATHS.ClipboardCheck, 'ClipboardCheck');
export const Clock = draw(ICON_PATHS.Clock, 'Clock');
export const Cloud = draw(ICON_PATHS.Cloud, 'Cloud');
export const Copy = draw(ICON_PATHS.Copy, 'Copy');
export const CreditCard = draw(ICON_PATHS.CreditCard, 'CreditCard');
export const Crown = draw(ICON_PATHS.Crown, 'Crown');
export const Delete = draw(ICON_PATHS.Delete, 'Delete');
export const Download = draw(ICON_PATHS.Download, 'Download');
export const Edit3 = draw(ICON_PATHS.Edit3, 'Edit3');
export const ExternalLink = draw(ICON_PATHS.ExternalLink, 'ExternalLink');
export const Eye = draw(ICON_PATHS.Eye, 'Eye');
export const EyeOff = draw(ICON_PATHS.EyeOff, 'EyeOff');
export const FileText = draw(ICON_PATHS.FileText, 'FileText');
export const Fingerprint = draw(ICON_PATHS.Fingerprint, 'Fingerprint');
export const Flame = draw(ICON_PATHS.Flame, 'Flame');
export const Globe = draw(ICON_PATHS.Globe, 'Globe');
export const HeartPulse = draw(ICON_PATHS.HeartPulse, 'HeartPulse');
export const HelpCircle = draw(ICON_PATHS.HelpCircle, 'HelpCircle');
export const Home = draw(ICON_PATHS.Home, 'Home');
export const ImageIcon = draw(ICON_PATHS.ImageIcon, 'ImageIcon');
export const Inbox = draw(ICON_PATHS.Inbox, 'Inbox');
export const KeyRound = draw(ICON_PATHS.KeyRound, 'KeyRound');
export const Lightbulb = draw(ICON_PATHS.Lightbulb, 'Lightbulb');
export const Lock = draw(ICON_PATHS.Lock, 'Lock');
export const LogOut = draw(ICON_PATHS.LogOut, 'LogOut');
export const Mail = draw(ICON_PATHS.Mail, 'Mail');
export const MessageCircle = draw(ICON_PATHS.MessageCircle, 'MessageCircle');
export const Mic = draw(ICON_PATHS.Mic, 'Mic');
export const Moon = draw(ICON_PATHS.Moon, 'Moon');
export const MoreHorizontal = draw(ICON_PATHS.MoreHorizontal, 'MoreHorizontal');
export const PartyPopper = draw(ICON_PATHS.PartyPopper, 'PartyPopper');
export const PieChart = draw(ICON_PATHS.PieChart, 'PieChart');
export const PiggyBank = draw(ICON_PATHS.PiggyBank, 'PiggyBank');
export const Play = draw(ICON_PATHS.Play, 'Play');
export const Plus = draw(ICON_PATHS.Plus, 'Plus');
export const PlusSquare = draw(ICON_PATHS.PlusSquare, 'PlusSquare');
export const Receipt = draw(ICON_PATHS.Receipt, 'Receipt');
export const RefreshCw = draw(ICON_PATHS.RefreshCw, 'RefreshCw');
export const Repeat = draw(ICON_PATHS.Repeat, 'Repeat');
export const RotateCcw = draw(ICON_PATHS.RotateCcw, 'RotateCcw');
export const Search = draw(ICON_PATHS.Search, 'Search');
export const Send = draw(ICON_PATHS.Send, 'Send');
export const Shield = draw(ICON_PATHS.Shield, 'Shield');
export const ShieldCheck = draw(ICON_PATHS.ShieldCheck, 'ShieldCheck');
export const SlidersHorizontal = draw(ICON_PATHS.SlidersHorizontal, 'SlidersHorizontal');
export const Smartphone = draw(ICON_PATHS.Smartphone, 'Smartphone');
export const Sparkles = draw(ICON_PATHS.Sparkles, 'Sparkles');
export const Sun = draw(ICON_PATHS.Sun, 'Sun');
export const Target = draw(ICON_PATHS.Target, 'Target');
export const Tick = draw(ICON_PATHS.Tick, 'Tick');
export const Trash2 = draw(ICON_PATHS.Trash2, 'Trash2');
export const TrendingUp = draw(ICON_PATHS.TrendingUp, 'TrendingUp');
export const Upload = draw(ICON_PATHS.Upload, 'Upload');
export const User = draw(ICON_PATHS.User, 'User');
export const User2 = draw(ICON_PATHS.User2, 'User2');
export const UserPlus = draw(ICON_PATHS.UserPlus, 'UserPlus');
export const Users = draw(ICON_PATHS.Users, 'Users');
export const Wallet = draw(ICON_PATHS.Wallet, 'Wallet');
export const Wrench = draw(ICON_PATHS.Wrench, 'Wrench');
export const X = draw(ICON_PATHS.X, 'X');
export const XCircle = draw(ICON_PATHS.XCircle, 'XCircle');
export const Zap = draw(ICON_PATHS.Zap, 'Zap');

// Category marks: the identity marks a category by its glyph on a tile.
export const Airplane = draw(ICON_PATHS.Airplane, 'Airplane');
export const Car = draw(ICON_PATHS.Car, 'Car');
export const Dumbbell = draw(ICON_PATHS.Dumbbell, 'Dumbbell');
export const Laptop = draw(ICON_PATHS.Laptop, 'Laptop');
export const MoneyIn = draw(ICON_PATHS.MoneyIn, 'MoneyIn');
export const Package = draw(ICON_PATHS.Package, 'Package');
export const ShoppingBag = draw(ICON_PATHS.ShoppingBag, 'ShoppingBag');
export const Tag = draw(ICON_PATHS.Tag, 'Tag');
export const Utensils = draw(ICON_PATHS.Utensils, 'Utensils');

export type IconComponent = ReturnType<typeof draw>;

/**
 * The tab bars' set.
 *
 * `fill` and `line` are the same outline now: the identity marks the active
 * tab with the tint and a soft capsule, never by filling the glyph. Both keys
 * stay so the tab layouts read them unchanged. They are chosen to be read with
 * **no label under them**.
 */
export const TabIcons = {
  home: { fill: draw(ICON_PATHS_BAR.Home, 'TabHome'), line: draw(ICON_PATHS_LINE.Home, 'TabHomeLine') },
  records: {
    fill: draw(ICON_PATHS_BAR.Records, 'TabRecords'),
    line: draw(ICON_PATHS_LINE.Records, 'TabRecordsLine'),
  },
  add: { fill: draw(ICON_PATHS_BAR.Add, 'TabAdd'), line: draw(ICON_PATHS_LINE.Add, 'TabAddLine') },
  insights: {
    fill: draw(ICON_PATHS_BAR.Insights, 'TabInsights'),
    line: draw(ICON_PATHS_LINE.Insights, 'TabInsightsLine'),
  },
  settings: {
    fill: draw(ICON_PATHS_BAR.Gear, 'TabSettings'),
    line: draw(ICON_PATHS_LINE.Gear, 'TabSettingsLine'),
  },
  advisor: {
    fill: draw(ICON_PATHS_BAR.Advisor, 'TabAdvisor'),
    line: draw(ICON_PATHS_LINE.Advisor, 'TabAdvisorLine'),
  },
  money: {
    fill: draw(ICON_PATHS_BAR.Money, 'TabMoney'),
    line: draw(ICON_PATHS_LINE.Money, 'TabMoneyLine'),
  },
} as const;
