-- Posting module phase 1b: add BOISSON to DishType so restaurants and
-- traiteurs can list standalone drinks (Coca-Cola, soda packs, …) that
-- aren't expressible via per-listing add-ons.
-- See docs/posting-module.md §2.6.c.
--
-- Separate migration file: Postgres requires `ALTER TYPE … ADD VALUE`
-- to land before any statement that references the new value;
-- keeping it alone makes the boundary explicit.

ALTER TYPE "DishType" ADD VALUE 'BOISSON';
