-- Postgres will not let a value added by ALTER TYPE ... ADD VALUE be used in
-- the same transaction that adds it, so nothing else belongs in this file.
ALTER TYPE "Officer" ADD VALUE IF NOT EXISTS 'VICE_PRESIDENT' AFTER 'PRESIDENT';
