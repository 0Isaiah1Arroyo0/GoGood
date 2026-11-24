-- Fridge/label photo scans save their items with source 'photo'; allow it.
ALTER TABLE public.draft_items DROP CONSTRAINT IF EXISTS draft_items_source_check;
ALTER TABLE public.draft_items ADD CONSTRAINT draft_items_source_check
  CHECK (source IN ('receipt', 'kroger', 'manual', 'photo'));
