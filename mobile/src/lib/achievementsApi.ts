/**
 * Client for the persisted-gamification backend (routes/achievements.ts).
 * Badges are computed locally by getUnlockedBadges() but persisted server-side
 * so they survive reinstalls and changing transactions.
 */
import { api } from './api/api';

export interface Achievement {
  id: string;
  badge: string;
  earnedAt: string;
  bestStreak: number;
}

export interface AchievementsState {
  achievements: Achievement[];
  bestStreak: number;
}

export interface SyncResult extends AchievementsState {
  newlyEarned: string[];
}

export async function getAchievements(): Promise<AchievementsState> {
  return api.get<AchievementsState>('/api/achievements');
}

/** Push locally-unlocked badges + current streak; returns any newly-earned. */
export async function syncAchievements(badges: string[], streak: number): Promise<SyncResult> {
  return api.post<SyncResult>('/api/achievements/sync', { badges, streak });
}
