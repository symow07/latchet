/**
 * What a run of steps tells VoiceOver.
 *
 * React Native speaks a { min, max, now } value as a percent, computed as
 * now / (max - min) (RCTView.m, and RCTViewComponentView.mm on Fabric): it
 * assumes min is 0. The onboarding bar counted its steps from 1, so its last
 * step of 4 was read as "133 percent" and its first as 33. The value now says
 * which step it is in words ("Step 2 of 4"), which iOS reads instead of a
 * percent, and its numbers start at 0, so a reader that still makes a percent
 * of them gets 25 to 100.
 *
 * Dependency-free, so it is tested without a device.
 */
export interface StepProgressValue {
  min: number;
  max: number;
  now: number;
  text?: string;
}

/** `current` is zero-based; `text` is the step in words, in the reader's language. */
export function stepProgressValue(total: number, current: number, text?: string): StepProgressValue {
  const max = Math.max(1, Math.round(total));
  const now = Math.min(max, Math.max(0, Math.round(current) + 1));
  return text ? { min: 0, max, now, text } : { min: 0, max, now };
}
