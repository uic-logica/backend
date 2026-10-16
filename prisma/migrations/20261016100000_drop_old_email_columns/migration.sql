-- `modes` replaced these; the code reading `modes` is deployed (#119).
ALTER TABLE "EmailPreference" DROP COLUMN "eventReminders", DROP COLUMN "announcements";
