-- 物品编码与所在位置解耦：移动物品只更新 location_code，id 永不改变。
CREATE TABLE IF NOT EXISTS inventory_locations (
  code TEXT PRIMARY KEY CHECK (
    code ~ '^[A-D][1-4]$'
    OR code IN ('FLOOR', 'DOOR', 'PENDING_A', 'PENDING_B', 'PENDING_C', 'PENDING_D')
  ),
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE,
  is_pending_level BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY CHECK (id ~ '^ITEM[0-9]{4}$'),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  location_code TEXT NOT NULL REFERENCES inventory_locations(code),
  quantity TEXT NOT NULL DEFAULT '若干',
  image_path TEXT,
  recognition_status TEXT NOT NULL DEFAULT '已确认',
  source_sequence INTEGER UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_location_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  from_location TEXT REFERENCES inventory_locations(code),
  to_location TEXT NOT NULL REFERENCES inventory_locations(code),
  moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION track_inventory_location_change()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  IF OLD.location_code IS DISTINCT FROM NEW.location_code THEN
    INSERT INTO inventory_location_history (item_id, from_location, to_location)
    VALUES (NEW.id, OLD.location_code, NEW.location_code);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventory_items_track_location ON inventory_items;
CREATE TRIGGER inventory_items_track_location
BEFORE UPDATE ON inventory_items
FOR EACH ROW EXECUTE FUNCTION track_inventory_location_change();

INSERT INTO inventory_locations (code, label, sort_order, is_pending_level) VALUES
  ('A1', 'A 货架 · 第 1 层', 11, FALSE),
  ('A2', 'A 货架 · 第 2 层', 12, FALSE), ('A3', 'A 货架 · 第 3 层', 13, FALSE),
  ('A4', 'A 货架 · 第 4 层', 14, FALSE),
  ('B1', 'B 货架 · 第 1 层', 21, FALSE), ('B2', 'B 货架 · 第 2 层', 22, FALSE),
  ('B3', 'B 货架 · 第 3 层', 23, FALSE), ('B4', 'B 货架 · 第 4 层', 24, FALSE),
  ('C1', 'C 货架 · 第 1 层', 31, FALSE),
  ('C2', 'C 货架 · 第 2 层', 32, FALSE), ('C3', 'C 货架 · 第 3 层', 33, FALSE),
  ('C4', 'C 货架 · 第 4 层', 34, FALSE),
  ('D1', 'D 货架 · 第 1 层', 41, FALSE), ('D2', 'D 货架 · 第 2 层', 42, FALSE),
  ('D3', 'D 货架 · 第 3 层', 43, FALSE), ('D4', 'D 货架 · 第 4 层', 44, FALSE),
  ('FLOOR', '地板区域', 50, FALSE), ('DOOR', '门后区域', 60, FALSE),
  ('PENDING_A', '待分层 · A 货架', 71, TRUE),
  ('PENDING_B', '待分层 · B 货架', 72, TRUE),
  ('PENDING_C', '待分层 · C 货架', 73, TRUE),
  ('PENDING_D', '待分层 · D 货架', 74, TRUE)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  is_pending_level = EXCLUDED.is_pending_level;
