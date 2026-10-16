-- Per-category email modes replace the two on/off switches. Keep what people turned off.
ALTER TABLE "EmailPreference" ADD COLUMN "modes" JSONB NOT NULL DEFAULT '{}';
UPDATE "EmailPreference" SET "modes" =
  (CASE WHEN "eventReminders" = false THEN '{"events":"OFF"}'::jsonb ELSE '{}'::jsonb END) ||
  (CASE WHEN "announcements" = false THEN '{"announcements":"OFF"}'::jsonb ELSE '{}'::jsonb END);
ALTER TABLE "EmailPreference" DROP COLUMN "eventReminders", DROP COLUMN "announcements";

ALTER TABLE "Notification" ADD COLUMN "emailLater" BOOLEAN NOT NULL DEFAULT false;
