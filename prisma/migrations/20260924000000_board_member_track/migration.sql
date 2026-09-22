-- PostgreSQL cannot use a newly added enum value in the transaction that adds it.
ALTER TYPE "ApplicationTrack" ADD VALUE IF NOT EXISTS 'BOARD_MEMBER';
