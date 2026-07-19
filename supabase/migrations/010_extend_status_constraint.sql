-- ============================================================
-- Расширяем CHECK constraint на статусы заказов:
-- добавляем error_balance и error_stars (используются в коде)
-- ============================================================

DO $$
BEGIN
  ALTER TABLE tma_stars_orders
    DROP CONSTRAINT IF EXISTS tma_stars_orders_status_check;

  ALTER TABLE tma_stars_orders
    ADD CONSTRAINT tma_stars_orders_status_check
    CHECK (status IN (
      'pending', 'processing', 'paid', 'completed',
      'expired', 'error_fragment', 'error_ton', 'error_balance', 'error_stars',
      'blocked'
    ));
END $$;
