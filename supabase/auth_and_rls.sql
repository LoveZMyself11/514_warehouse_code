-- Run after schema_v2.sql. Supabase Auth proves identity; public.users stores
-- application roles and account status. Anonymous clients receive no access.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS position TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notes TEXT;
CREATE INDEX IF NOT EXISTS idx_users_department_role ON public.users(department_id, role);
CREATE INDEX IF NOT EXISTS idx_borrow_orders_department_status ON public.borrow_orders(department_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_unique
ON public.users (auth_user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_auth_user_id_fkey'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION private.handle_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (name, email, auth_user_id, role, is_active)
  VALUES (
    COALESCE(
      NULLIF(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      '新用户'
    ),
    NEW.email,
    NEW.id,
    'member',
    FALSE
  )
  ON CONFLICT (auth_user_id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.handle_auth_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_changed ON auth.users;
CREATE TRIGGER on_auth_user_changed
AFTER INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.handle_auth_user();

-- Backfill profiles for Auth users created before this trigger.
INSERT INTO public.users (name, email, auth_user_id, role, is_active)
SELECT
  COALESCE(
    NULLIF(btrim(au.raw_user_meta_data ->> 'name'), ''),
    NULLIF(split_part(COALESCE(au.email, ''), '@', 1), ''),
    '新用户'
  ),
  au.email,
  au.id,
  'member',
  FALSE
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.users u WHERE u.auth_user_id = au.id
);

CREATE OR REPLACE FUNCTION private.current_app_user_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id
  FROM public.users u
  WHERE u.auth_user_id = (SELECT auth.uid())
    AND u.is_active
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.current_app_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.role
  FROM public.users u
  WHERE u.auth_user_id = (SELECT auth.uid())
    AND u.is_active
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.current_app_department_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.department_id
  FROM public.users u
  WHERE u.auth_user_id = (SELECT auth.uid())
    AND u.is_active
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION private.current_app_user_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.current_app_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.current_app_department_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_app_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_app_department_id() TO authenticated;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE public.users SET role = 'admin' WHERE role = 'manager';
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'admin', 'member'));

CREATE OR REPLACE FUNCTION private.track_inventory_location_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  NEW.updated_at = NOW();
  IF OLD.location_code IS DISTINCT FROM NEW.location_code THEN
    INSERT INTO public.inventory_location_history (item_id, from_location, to_location)
    VALUES (NEW.id, OLD.location_code, NEW.location_code);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.track_inventory_location_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS inventory_items_track_location ON public.inventory_items;
DROP FUNCTION IF EXISTS public.track_inventory_location_change();
CREATE TRIGGER inventory_items_track_location
BEFORE UPDATE ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION private.track_inventory_location_change();

REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_location_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrow_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrow_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.inventory_locations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inventory_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inventory_location_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.departments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.borrow_orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.borrow_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.operation_logs FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.inventory_locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_items TO authenticated;
GRANT SELECT ON TABLE public.inventory_location_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.departments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.borrow_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.borrow_items TO authenticated;
GRANT SELECT ON TABLE public.operation_logs TO authenticated;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.departments_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.users_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.borrow_orders_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.borrow_items_id_seq TO authenticated;

DROP POLICY IF EXISTS "Active users view locations" ON public.inventory_locations;
CREATE POLICY "Active users view locations" ON public.inventory_locations
FOR SELECT TO authenticated
USING ((SELECT private.current_app_user_id()) IS NOT NULL);

DROP POLICY IF EXISTS "Active users view inventory" ON public.inventory_items;
CREATE POLICY "Active users view inventory" ON public.inventory_items
FOR SELECT TO authenticated
USING ((SELECT private.current_app_user_id()) IS NOT NULL);

DROP POLICY IF EXISTS "Super admins create inventory" ON public.inventory_items;
CREATE POLICY "Super admins create inventory" ON public.inventory_items
FOR INSERT TO authenticated
WITH CHECK ((SELECT private.current_app_role()) = 'super_admin');

DROP POLICY IF EXISTS "Super admins update inventory" ON public.inventory_items;
CREATE POLICY "Super admins update inventory" ON public.inventory_items
FOR UPDATE TO authenticated
USING ((SELECT private.current_app_role()) = 'super_admin')
WITH CHECK ((SELECT private.current_app_role()) = 'super_admin');

DROP POLICY IF EXISTS "Super admins delete inventory" ON public.inventory_items;
CREATE POLICY "Super admins delete inventory" ON public.inventory_items
FOR DELETE TO authenticated
USING ((SELECT private.current_app_role()) = 'super_admin');

DROP POLICY IF EXISTS "Active users view location history" ON public.inventory_location_history;
CREATE POLICY "Active users view location history" ON public.inventory_location_history
FOR SELECT TO authenticated
USING ((SELECT private.current_app_user_id()) IS NOT NULL);

DROP POLICY IF EXISTS "Active users view departments" ON public.departments;
CREATE POLICY "Active users view departments" ON public.departments
FOR SELECT TO authenticated
USING ((SELECT private.current_app_user_id()) IS NOT NULL);

DROP POLICY IF EXISTS "Admins create departments" ON public.departments;
DROP POLICY IF EXISTS "Super admins create departments" ON public.departments;
CREATE POLICY "Super admins create departments" ON public.departments
FOR INSERT TO authenticated
WITH CHECK ((SELECT private.current_app_role()) = 'super_admin');

DROP POLICY IF EXISTS "Admins update departments" ON public.departments;
DROP POLICY IF EXISTS "Super admins update departments" ON public.departments;
CREATE POLICY "Super admins update departments" ON public.departments
FOR UPDATE TO authenticated
USING ((SELECT private.current_app_role()) = 'super_admin')
WITH CHECK ((SELECT private.current_app_role()) = 'super_admin');

DROP POLICY IF EXISTS "Admins delete departments" ON public.departments;
DROP POLICY IF EXISTS "Super admins delete departments" ON public.departments;
CREATE POLICY "Super admins delete departments" ON public.departments
FOR DELETE TO authenticated
USING ((SELECT private.current_app_role()) = 'super_admin');

DROP POLICY IF EXISTS "Users view own profile and admins view all" ON public.users;
CREATE POLICY "Users view own profile and admins view all" ON public.users
FOR SELECT TO authenticated
USING (
  auth_user_id = (SELECT auth.uid())
  OR (SELECT private.current_app_role()) = 'super_admin'
  OR (
    (SELECT private.current_app_role()) = 'admin'
    AND role = 'member'
    AND department_id = (SELECT private.current_app_department_id())
  )
);

DROP POLICY IF EXISTS "Admins create users" ON public.users;
DROP POLICY IF EXISTS "Super admins create users" ON public.users;
CREATE POLICY "Super admins create users" ON public.users
FOR INSERT TO authenticated
WITH CHECK ((SELECT private.current_app_role()) = 'super_admin');

DROP POLICY IF EXISTS "Admins update users" ON public.users;
DROP POLICY IF EXISTS "Super admins update users" ON public.users;
CREATE POLICY "Super admins update users" ON public.users
FOR UPDATE TO authenticated
USING ((SELECT private.current_app_role()) = 'super_admin')
WITH CHECK ((SELECT private.current_app_role()) = 'super_admin');

DROP POLICY IF EXISTS "Department admins update members" ON public.users;
-- Department admins update members through public.update_department_member(),
-- which whitelists editable profile fields and never accepts role/department/auth IDs.

DROP POLICY IF EXISTS "Admins delete users" ON public.users;
DROP POLICY IF EXISTS "Super admins delete users" ON public.users;
CREATE POLICY "Super admins delete users" ON public.users
FOR DELETE TO authenticated
USING ((SELECT private.current_app_role()) = 'super_admin');

DROP POLICY IF EXISTS "Users view own orders and staff view all" ON public.borrow_orders;
CREATE POLICY "Users view own orders and staff view all" ON public.borrow_orders
FOR SELECT TO authenticated
USING (
  user_id = (SELECT private.current_app_user_id())
  OR (SELECT private.current_app_role()) = 'super_admin'
  OR (
    (SELECT private.current_app_role()) = 'admin'
    AND department_id = (SELECT private.current_app_department_id())
  )
);

DROP POLICY IF EXISTS "Users create own pending orders" ON public.borrow_orders;
CREATE POLICY "Users create own pending orders" ON public.borrow_orders
FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT private.current_app_user_id())
  AND status = 'pending'
  AND actual_return_date IS NULL
  AND department_id IS NOT DISTINCT FROM (SELECT private.current_app_department_id())
);

DROP POLICY IF EXISTS "Staff update orders" ON public.borrow_orders;
CREATE POLICY "Staff update orders" ON public.borrow_orders
FOR UPDATE TO authenticated
USING (
  (SELECT private.current_app_role()) = 'super_admin'
)
WITH CHECK (
  (SELECT private.current_app_role()) = 'super_admin'
);

DROP POLICY IF EXISTS "Admins delete orders" ON public.borrow_orders;
CREATE POLICY "Admins delete orders" ON public.borrow_orders
FOR DELETE TO authenticated
USING ((SELECT private.current_app_role()) = 'super_admin');

DROP POLICY IF EXISTS "Users view own order items and staff view all" ON public.borrow_items;
CREATE POLICY "Users view own order items and staff view all" ON public.borrow_items
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.borrow_orders bo
    WHERE bo.id = order_id
      AND (
        bo.user_id = (SELECT private.current_app_user_id())
        OR (SELECT private.current_app_role()) = 'super_admin'
        OR (
          (SELECT private.current_app_role()) = 'admin'
          AND bo.department_id = (SELECT private.current_app_department_id())
        )
      )
  )
);

DROP POLICY IF EXISTS "Users create items for own pending orders" ON public.borrow_items;
CREATE POLICY "Users create items for own pending orders" ON public.borrow_items
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.borrow_orders bo
    WHERE bo.id = order_id
      AND bo.user_id = (SELECT private.current_app_user_id())
      AND bo.status = 'pending'
  )
);

DROP POLICY IF EXISTS "Staff update order items" ON public.borrow_items;
CREATE POLICY "Staff update order items" ON public.borrow_items
FOR UPDATE TO authenticated
USING (
  (SELECT private.current_app_role()) = 'super_admin'
)
WITH CHECK (
  (SELECT private.current_app_role()) = 'super_admin'
);

DROP POLICY IF EXISTS "Admins delete order items" ON public.borrow_items;
CREATE POLICY "Admins delete order items" ON public.borrow_items
FOR DELETE TO authenticated
USING ((SELECT private.current_app_role()) = 'super_admin');

DROP POLICY IF EXISTS "Staff view operation logs" ON public.operation_logs;
CREATE POLICY "Staff view operation logs" ON public.operation_logs
FOR SELECT TO authenticated
USING ((SELECT private.current_app_role()) = 'super_admin');

-- Controlled writes for department admins. These functions are intentionally
-- SECURITY DEFINER because the caller's RLS policy cannot safely express a
-- column-level whitelist. Each function still authenticates the caller and
-- checks the active application role and department before writing.
CREATE OR REPLACE FUNCTION public.update_department_member(
  p_user_id BIGINT,
  p_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_position TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.users%ROWTYPE;
BEGIN
  IF (SELECT private.current_app_role()) IS DISTINCT FROM 'admin'
     OR (SELECT private.current_app_user_id()) IS NULL THEN
    RAISE EXCEPTION 'Only active department admins can update members';
  END IF;
  SELECT * INTO target FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target user not found'; END IF;
  IF target.role <> 'member'
     OR target.department_id IS DISTINCT FROM (SELECT private.current_app_department_id()) THEN
    RAISE EXCEPTION 'Department admins can only update members in their own department';
  END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'Name is required'; END IF;

  UPDATE public.users
  SET name = btrim(p_name),
      phone = NULLIF(btrim(p_phone), ''),
      position = NULLIF(btrim(p_position), ''),
      notes = NULLIF(btrim(p_notes), ''),
      is_active = p_is_active,
      updated_at = NOW()
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_department_member(BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_department_member(BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_borrow_order_status(
  p_order_id BIGINT,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.borrow_orders%ROWTYPE;
  actor_id BIGINT;
  actor_role TEXT;
BEGIN
  actor_role := (SELECT private.current_app_role());
  actor_id := (SELECT private.current_app_user_id());
  IF actor_role NOT IN ('super_admin', 'admin') OR actor_id IS NULL THEN
    RAISE EXCEPTION 'Only active administrators can update order status';
  END IF;
  IF p_status NOT IN ('pending', 'approved', 'borrowed', 'returned', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid borrow order status';
  END IF;
  SELECT * INTO target FROM public.borrow_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Borrow order not found'; END IF;
  IF actor_role = 'admin'
     AND target.department_id IS DISTINCT FROM (SELECT private.current_app_department_id()) THEN
    RAISE EXCEPTION 'Department admins can only update orders in their own department';
  END IF;

  UPDATE public.borrow_orders
  SET status = p_status,
      actual_return_date = CASE WHEN p_status = 'returned' THEN COALESCE(actual_return_date, NOW()) ELSE NULL END,
      notes = CASE WHEN p_notes IS NULL THEN notes ELSE NULLIF(btrim(p_notes), '') END,
      updated_at = NOW()
  WHERE id = p_order_id;

  INSERT INTO public.operation_logs (user_id, order_id, action, details)
  VALUES (actor_id, p_order_id, 'update', jsonb_build_object('source', actor_role, 'status', p_status));
END;
$$;

REVOKE ALL ON FUNCTION public.update_borrow_order_status(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_borrow_order_status(BIGINT, TEXT, TEXT) TO authenticated;

CREATE SEQUENCE IF NOT EXISTS public.borrow_order_number_seq START WITH 1;
REVOKE ALL ON SEQUENCE public.borrow_order_number_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_borrow_order(
  p_item_id TEXT,
  p_quantity INTEGER,
  p_reason TEXT,
  p_expected_return_date DATE,
  p_notes TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id BIGINT;
  actor_department_id BIGINT;
  new_order_id BIGINT;
  new_order_number TEXT;
BEGIN
  actor_id := (SELECT private.current_app_user_id());
  actor_department_id := (SELECT private.current_app_department_id());
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Borrow reason is required'; END IF;
  IF p_expected_return_date IS NULL OR p_expected_return_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Expected return date cannot be before today';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_items WHERE id = p_item_id) THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  new_order_number := 'BO' || to_char(CURRENT_DATE, 'YYYYMMDD')
    || lpad(nextval('public.borrow_order_number_seq')::TEXT, 5, '0');
  INSERT INTO public.borrow_orders (
    order_number, user_id, department_id, status, reason, expected_return_date, notes
  ) VALUES (
    new_order_number, actor_id, actor_department_id, 'pending', btrim(p_reason),
    p_expected_return_date, NULLIF(btrim(p_notes), '')
  ) RETURNING id INTO new_order_id;

  INSERT INTO public.borrow_items (order_id, item_id, quantity_borrowed)
  VALUES (new_order_id, p_item_id, p_quantity);

  INSERT INTO public.operation_logs (user_id, item_id, order_id, action, details)
  VALUES (actor_id, p_item_id, new_order_id, 'borrow', jsonb_build_object('source', 'self_service', 'status', 'pending'));

  RETURN new_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_borrow_order(TEXT, INTEGER, TEXT, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_borrow_order(TEXT, INTEGER, TEXT, DATE, TEXT) TO authenticated;
