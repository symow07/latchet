-- Align UserSettings.primaryGoal with the vocabulary onboarding actually writes
-- ("save" | "track" | "reduce_debt" | "budget"). Rows created under the old
-- backend-only vocabulary are mapped to their closest equivalent.
UPDATE "UserSettings" SET "primaryGoal" = 'reduce_debt' WHERE "primaryGoal" = 'debt';
UPDATE "UserSettings" SET "primaryGoal" = 'save' WHERE "primaryGoal" = 'invest';
