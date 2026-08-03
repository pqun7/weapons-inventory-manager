-- weapon_types
CREATE TABLE IF NOT EXISTS weapon_types (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT        NOT NULL UNIQUE,
  sort_order SMALLINT    NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_weapon_types_sort ON weapon_types(sort_order);
ALTER TABLE weapon_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_weapon_types" ON weapon_types FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_weapon_types" ON weapon_types FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_weapon_types" ON weapon_types FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_weapon_types" ON weapon_types FOR DELETE TO anon, authenticated USING (true);

-- weapon_subtypes
CREATE TABLE IF NOT EXISTS weapon_subtypes (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  weapon_type_id UUID        NOT NULL REFERENCES weapon_types(id) ON DELETE CASCADE,
  label          TEXT        NOT NULL,
  sort_order     SMALLINT    NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (weapon_type_id, label)
);
CREATE INDEX IF NOT EXISTS idx_weapon_subtypes_type_id ON weapon_subtypes(weapon_type_id);
ALTER TABLE weapon_subtypes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_weapon_subtypes" ON weapon_subtypes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_weapon_subtypes" ON weapon_subtypes FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_weapon_subtypes" ON weapon_subtypes FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_weapon_subtypes" ON weapon_subtypes FOR DELETE TO anon, authenticated USING (true);

-- calibers
CREATE TABLE IF NOT EXISTS calibers (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE calibers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_calibers" ON calibers FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_calibers" ON calibers FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_calibers" ON calibers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_calibers" ON calibers FOR DELETE TO anon, authenticated USING (true);

-- subtype_calibers (junction)
CREATE TABLE IF NOT EXISTS subtype_calibers (
  subtype_id UUID NOT NULL REFERENCES weapon_subtypes(id) ON DELETE CASCADE,
  caliber_id UUID NOT NULL REFERENCES calibers(id) ON DELETE CASCADE,
  PRIMARY KEY (subtype_id, caliber_id)
);
CREATE INDEX IF NOT EXISTS idx_subtype_calibers_caliber ON subtype_calibers(caliber_id);
ALTER TABLE subtype_calibers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_subtype_calibers" ON subtype_calibers FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_subtype_calibers" ON subtype_calibers FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_delete_subtype_calibers" ON subtype_calibers FOR DELETE TO anon, authenticated USING (true);

-- brands
CREATE TABLE IF NOT EXISTS brands (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_brands" ON brands FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_brands" ON brands FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_brands" ON brands FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_brands" ON brands FOR DELETE TO anon, authenticated USING (true);

-- models
CREATE TABLE IF NOT EXISTS models (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT        NOT NULL,
  brand_id   UUID        REFERENCES brands(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (label, brand_id)
);
CREATE INDEX IF NOT EXISTS idx_models_brand_id ON models(brand_id);
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_models" ON models FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_models" ON models FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_models" ON models FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_models" ON models FOR DELETE TO anon, authenticated USING (true);

-- warehouses
CREATE TABLE IF NOT EXISTS warehouses (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_warehouses" ON warehouses FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_warehouses" ON warehouses FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_warehouses" ON warehouses FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_warehouses" ON warehouses FOR DELETE TO anon, authenticated USING (true);

-- storage_locations
CREATE TABLE IF NOT EXISTS storage_locations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID        NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  shelf        TEXT        NOT NULL,
  bin          TEXT        NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, shelf, bin)
);
CREATE INDEX IF NOT EXISTS idx_storage_locations_warehouse ON storage_locations(warehouse_id);
ALTER TABLE storage_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_storage_locations" ON storage_locations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_storage_locations" ON storage_locations FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_storage_locations" ON storage_locations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_storage_locations" ON storage_locations FOR DELETE TO anon, authenticated USING (true);

-- ── SEED DATA ──────────────────────────────────────────────────────────────

INSERT INTO weapon_types (label, sort_order) VALUES
  ('Shotgun',      1),
  ('Air rifle',    2),
  ('Blank pistol', 3),
  ('Pistol',       4),
  ('Rifle',        5)
ON CONFLICT (label) DO NOTHING;

WITH types AS (SELECT id, label FROM weapon_types)
INSERT INTO weapon_subtypes (weapon_type_id, label, sort_order)
SELECT t.id, s.label, s.sort_order FROM types t
JOIN (VALUES
  ('Shotgun',      'Semi-auto',        1),
  ('Shotgun',      'Magazine shotgun', 2),
  ('Shotgun',      'Folding shotgun',  3),
  ('Shotgun',      'Over&under',       4),
  ('Shotgun',      'Side by side',     5),
  ('Shotgun',      'Single barrel',    6),
  ('Air rifle',    'PCP',              1),
  ('Air rifle',    'Break barrel',     2),
  ('Blank pistol', '9mm',              1),
  ('Pistol',       '9x19mm',           1),
  ('Pistol',       '7.62mm',           2),
  ('Pistol',       '7.65mm',           3),
  ('Pistol',       '380mm',            4),
  ('Pistol',       '.22 LR',           5),
  ('Rifle',        '223',              1),
  ('Rifle',        '30-06',            2)
) AS s(type_label, label, sort_order) ON t.label = s.type_label
ON CONFLICT (weapon_type_id, label) DO NOTHING;

INSERT INTO calibers (label) VALUES
  ('12 GA'), ('20 GA'), ('.177'), ('.22'), ('.25'),
  ('9mm blank'), ('9x19mm'), ('7.62mm'), ('7.65mm'),
  ('.380 ACP'), ('.22 LR'), ('.223 Rem'), ('30-06'),
  ('9 mm rubber'), ('Cal 12 shotgun cartridges'),
  ('9x19'), ('7.62'), ('7.65'), ('223')
ON CONFLICT (label) DO NOTHING;

WITH st AS (SELECT id, label, weapon_type_id FROM weapon_subtypes),
     c  AS (SELECT id, label FROM calibers),
     wt AS (SELECT id, label FROM weapon_types)
INSERT INTO subtype_calibers (subtype_id, caliber_id)
SELECT st.id, c.id
FROM (VALUES
  ('Shotgun','Semi-auto','12 GA'),        ('Shotgun','Semi-auto','20 GA'),
  ('Shotgun','Magazine shotgun','12 GA'), ('Shotgun','Folding shotgun','12 GA'),
  ('Shotgun','Over&under','12 GA'),       ('Shotgun','Over&under','20 GA'),
  ('Shotgun','Side by side','12 GA'),     ('Shotgun','Single barrel','12 GA'),
  ('Shotgun','Single barrel','20 GA'),
  ('Air rifle','PCP','.177'),             ('Air rifle','PCP','.22'),
  ('Air rifle','PCP','.25'),              ('Air rifle','Break barrel','.177'),
  ('Air rifle','Break barrel','.22'),
  ('Blank pistol','9mm','9mm blank'),
  ('Pistol','9x19mm','9x19mm'),           ('Pistol','7.62mm','7.62mm'),
  ('Pistol','7.65mm','7.65mm'),           ('Pistol','380mm','.380 ACP'),
  ('Pistol','.22 LR','.22 LR'),
  ('Rifle','223','.223 Rem'),             ('Rifle','30-06','30-06')
) AS pairs(type_label, subtype_label, caliber_label)
JOIN wt ON wt.label = pairs.type_label
JOIN st ON st.label = pairs.subtype_label AND st.weapon_type_id = wt.id
JOIN c  ON c.label  = pairs.caliber_label
ON CONFLICT DO NOTHING;

INSERT INTO brands (label) VALUES
  ('Glock'), ('SIG Sauer'), ('Remington'), ('Benelli'),
  ('Colt'), ('Ruger'), ('Benjamin'), ('Ekol'), ('Hatsan')
ON CONFLICT (label) DO NOTHING;

INSERT INTO warehouses (label) VALUES ('Main'), ('Secondary'), ('Archive')
ON CONFLICT (label) DO NOTHING;
