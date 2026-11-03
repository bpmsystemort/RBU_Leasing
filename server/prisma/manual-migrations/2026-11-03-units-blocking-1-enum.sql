-- SP2 part 1: run this file ALONE. Postgres cannot use a new enum value in the same batch that adds it.
ALTER TYPE "UnitStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';
ALTER TYPE "UnitStatus" ADD VALUE IF NOT EXISTS 'UNAVAILABLE';
