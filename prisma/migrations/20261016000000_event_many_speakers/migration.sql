-- Several guests can share one event (a panel, co-founders): eventId is no longer unique.
DROP INDEX "SpeakerSubmission_eventId_key";
