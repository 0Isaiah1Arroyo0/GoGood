-- Allow fractional quantities (e.g. 23.9 oz after using a portion)
ALTER TABLE food_items ALTER COLUMN qty_num TYPE real;
