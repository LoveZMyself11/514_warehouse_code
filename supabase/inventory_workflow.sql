-- Run after schema_v2.sql and auth_and_rls.sql.
-- Canonical inventory rows and proposed changes are intentionally isolated.

ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS specification TEXT;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS image_name TEXT;

UPDATE public.inventory_items
SET image_name = regexp_replace(image_path, '^.*/', '')
WHERE image_name IS NULL AND image_path IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.inventory_change_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_type TEXT NOT NULL CHECK (request_type IN ('create', 'update', 'delete')),
  item_id TEXT CHECK (item_id IS NULL OR item_id ~ '^ITEM[0-9]{4}$'),
  result_item_id TEXT CHECK (result_item_id IS NULL OR result_item_id ~ '^ITEM[0-9]{4}$'),
  proposed_name TEXT,
  proposed_location_code TEXT REFERENCES public.inventory_locations(code),
  proposed_specification TEXT,
  proposed_quantity TEXT,
  proposed_image_name TEXT,
  proposed_image_path TEXT,
  proposed_recognition_status TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reviewed_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (request_type = 'create' AND item_id IS NULL AND proposed_name IS NOT NULL AND proposed_location_code IS NOT NULL)
    OR (request_type IN ('update', 'delete') AND item_id IS NOT NULL)
  )
);

ALTER TABLE public.inventory_change_requests ADD COLUMN IF NOT EXISTS result_item_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_change_requests_result_item_id_check'
      AND conrelid = 'public.inventory_change_requests'::regclass
  ) THEN
    ALTER TABLE public.inventory_change_requests
      ADD CONSTRAINT inventory_change_requests_result_item_id_check
      CHECK (result_item_id IS NULL OR result_item_id ~ '^ITEM[0-9]{4}$');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_inventory_change_requests_status
ON public.inventory_change_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_change_requests_requester
ON public.inventory_change_requests(requested_by, created_at DESC);

DROP TRIGGER IF EXISTS inventory_change_requests_update_timestamp ON public.inventory_change_requests;
CREATE TRIGGER inventory_change_requests_update_timestamp
BEFORE UPDATE ON public.inventory_change_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE SEQUENCE IF NOT EXISTS public.inventory_item_number_seq START WITH 1;
REVOKE ALL ON SEQUENCE public.inventory_item_number_seq FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  max_item_number BIGINT;
  sequence_value BIGINT;
  sequence_called BOOLEAN;
  safe_value BIGINT;
BEGIN
  SELECT COALESCE(MAX(substring(id FROM 5)::BIGINT), 0)
  INTO max_item_number
  FROM public.inventory_items;

  SELECT last_value, is_called
  INTO sequence_value, sequence_called
  FROM public.inventory_item_number_seq;

  safe_value := GREATEST(max_item_number, CASE WHEN sequence_called THEN sequence_value ELSE 0 END);
  PERFORM setval('public.inventory_item_number_seq', GREATEST(safe_value, 1), safe_value > 0);
END
$$;

CREATE OR REPLACE FUNCTION private.allocate_inventory_item_id()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT 'ITEM' || lpad(nextval('public.inventory_item_number_seq')::TEXT, 4, '0')
$$;

REVOKE ALL ON FUNCTION private.allocate_inventory_item_id() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_inventory_item(
  p_name TEXT,
  p_location_code TEXT,
  p_quantity TEXT DEFAULT '若干',
  p_specification TEXT DEFAULT NULL,
  p_image_name TEXT DEFAULT NULL,
  p_image_path TEXT DEFAULT NULL,
  p_recognition_status TEXT DEFAULT '人工录入'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_item_id TEXT;
  actor_id BIGINT;
BEGIN
  IF (SELECT private.current_app_role()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super administrators can create inventory directly';
  END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Item name is required';
  END IF;

  actor_id := (SELECT private.current_app_user_id());
  new_item_id := (SELECT private.allocate_inventory_item_id());

  INSERT INTO public.inventory_items (
    id, name, location_code, specification, quantity, image_name,
    image_path, recognition_status, source_sequence
  ) VALUES (
    new_item_id, btrim(p_name), p_location_code, NULLIF(btrim(p_specification), ''),
    COALESCE(NULLIF(btrim(p_quantity), ''), '若干'), NULLIF(btrim(p_image_name), ''),
    NULLIF(btrim(p_image_path), ''), COALESCE(NULLIF(btrim(p_recognition_status), ''), '人工录入'), NULL
  );

  INSERT INTO public.operation_logs (user_id, item_id, action, details)
  VALUES (actor_id, new_item_id, 'create', jsonb_build_object('source', 'direct_super_admin'));

  RETURN new_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_inventory_item(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_inventory_item(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_inventory_item(
  p_item_id TEXT,
  p_name TEXT,
  p_location_code TEXT,
  p_quantity TEXT,
  p_specification TEXT DEFAULT NULL,
  p_image_name TEXT DEFAULT NULL,
  p_image_path TEXT DEFAULT NULL,
  p_recognition_status TEXT DEFAULT '已确认'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id BIGINT;
BEGIN
  IF (SELECT private.current_app_role()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super administrators can update inventory directly';
  END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'Item name is required'; END IF;

  actor_id := (SELECT private.current_app_user_id());
  UPDATE public.inventory_items
  SET
    name = btrim(p_name),
    location_code = p_location_code,
    specification = NULLIF(btrim(p_specification), ''),
    quantity = COALESCE(NULLIF(btrim(p_quantity), ''), '若干'),
    image_name = NULLIF(btrim(p_image_name), ''),
    image_path = NULLIF(btrim(p_image_path), ''),
    recognition_status = COALESCE(NULLIF(btrim(p_recognition_status), ''), '已确认')
  WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target inventory item not found'; END IF;

  INSERT INTO public.operation_logs (user_id, item_id, action, details)
  VALUES (actor_id, p_item_id, 'update', jsonb_build_object('source', 'direct_super_admin'));
END;
$$;

REVOKE ALL ON FUNCTION public.update_inventory_item(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_inventory_item(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_inventory_item(p_item_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id BIGINT;
  deleted_name TEXT;
BEGIN
  IF (SELECT private.current_app_role()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super administrators can delete inventory directly';
  END IF;

  actor_id := (SELECT private.current_app_user_id());
  SELECT name INTO deleted_name FROM public.inventory_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target inventory item not found'; END IF;

  INSERT INTO public.operation_logs (user_id, item_id, action, details)
  VALUES (actor_id, p_item_id, 'delete', jsonb_build_object('source', 'direct_super_admin', 'item_id', p_item_id, 'name', deleted_name));
  DELETE FROM public.inventory_items WHERE id = p_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_inventory_item(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_inventory_item(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_inventory_change_request(
  p_request_id BIGINT,
  p_approve BOOLEAN,
  p_review_note TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_row public.inventory_change_requests%ROWTYPE;
  actor_id BIGINT;
  affected_item_id TEXT;
BEGIN
  IF (SELECT private.current_app_role()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super administrators can review inventory changes';
  END IF;

  actor_id := (SELECT private.current_app_user_id());
  SELECT * INTO request_row
  FROM public.inventory_change_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Change request not found'; END IF;
  IF request_row.status <> 'pending' THEN RAISE EXCEPTION 'Change request has already been reviewed'; END IF;

  affected_item_id := request_row.item_id;

  IF p_approve THEN
    IF request_row.request_type = 'create' THEN
      affected_item_id := (SELECT private.allocate_inventory_item_id());
      INSERT INTO public.inventory_items (
        id, name, location_code, specification, quantity, image_name,
        image_path, recognition_status, source_sequence
      ) VALUES (
        affected_item_id,
        btrim(request_row.proposed_name),
        request_row.proposed_location_code,
        NULLIF(btrim(request_row.proposed_specification), ''),
        COALESCE(NULLIF(btrim(request_row.proposed_quantity), ''), '若干'),
        NULLIF(btrim(request_row.proposed_image_name), ''),
        NULLIF(btrim(request_row.proposed_image_path), ''),
        COALESCE(NULLIF(btrim(request_row.proposed_recognition_status), ''), '人工录入'),
        NULL
      );
    ELSIF request_row.request_type = 'update' THEN
      UPDATE public.inventory_items
      SET
        name = COALESCE(NULLIF(btrim(request_row.proposed_name), ''), name),
        location_code = COALESCE(request_row.proposed_location_code, location_code),
        specification = CASE
          WHEN request_row.proposed_specification IS NULL THEN specification
          ELSE NULLIF(btrim(request_row.proposed_specification), '')
        END,
        quantity = COALESCE(NULLIF(btrim(request_row.proposed_quantity), ''), quantity),
        image_name = CASE
          WHEN request_row.proposed_image_name IS NULL THEN image_name
          ELSE NULLIF(btrim(request_row.proposed_image_name), '')
        END,
        image_path = CASE
          WHEN request_row.proposed_image_path IS NULL THEN image_path
          ELSE NULLIF(btrim(request_row.proposed_image_path), '')
        END,
        recognition_status = COALESCE(NULLIF(btrim(request_row.proposed_recognition_status), ''), recognition_status)
      WHERE id = request_row.item_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Target inventory item not found'; END IF;
    ELSE
      DELETE FROM public.inventory_items WHERE id = request_row.item_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Target inventory item not found'; END IF;
    END IF;

    INSERT INTO public.operation_logs (user_id, item_id, action, details)
    VALUES (
      actor_id,
      CASE WHEN request_row.request_type = 'delete' THEN NULL ELSE affected_item_id END,
      request_row.request_type,
      jsonb_build_object('source', 'approved_request', 'request_id', request_row.id, 'item_id', affected_item_id)
    );
  END IF;

  UPDATE public.inventory_change_requests
  SET
    result_item_id = CASE WHEN p_approve THEN affected_item_id ELSE NULL END,
    status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    reviewed_by = actor_id,
    review_note = NULLIF(btrim(p_review_note), ''),
    reviewed_at = NOW()
  WHERE id = request_row.id;

  RETURN affected_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.review_inventory_change_request(BIGINT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_inventory_change_request(BIGINT, BOOLEAN, TEXT) TO authenticated;

ALTER TABLE public.inventory_change_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_change_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.inventory_change_requests TO authenticated;
REVOKE ALL ON SEQUENCE public.inventory_change_requests_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.inventory_change_requests_id_seq TO authenticated;

DROP POLICY IF EXISTS "Users view own change requests and super admins view all" ON public.inventory_change_requests;
CREATE POLICY "Users view own change requests and super admins view all"
ON public.inventory_change_requests FOR SELECT TO authenticated
USING (
  requested_by = (SELECT private.current_app_user_id())
  OR (SELECT private.current_app_role()) = 'super_admin'
);

DROP POLICY IF EXISTS "Users submit own pending change requests" ON public.inventory_change_requests;
CREATE POLICY "Users submit own pending change requests"
ON public.inventory_change_requests FOR INSERT TO authenticated
WITH CHECK (
  requested_by = (SELECT private.current_app_user_id())
  AND status = 'pending'
  AND result_item_id IS NULL
  AND reviewed_by IS NULL
  AND review_note IS NULL
  AND reviewed_at IS NULL
);

DROP POLICY IF EXISTS "Users withdraw own pending change requests" ON public.inventory_change_requests;
CREATE POLICY "Users withdraw own pending change requests"
ON public.inventory_change_requests FOR DELETE TO authenticated
USING (
  requested_by = (SELECT private.current_app_user_id())
  AND status = 'pending'
);
