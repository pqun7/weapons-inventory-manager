from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))


def load_script(name: str):
    path = SCRIPTS / name
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


reset_db = load_script("reset-db.py")
seed_db = load_script("seed-db.py")
check_public_env = load_script("check-public-env.py")
reconcile_migrations = load_script("reconcile-supabase-migration-history.py")


class FakeTriggerCursor:
    def __init__(self, exists: bool):
        self.exists = exists

    def execute(self, _statement: str) -> None:
        return None

    def fetchone(self):
        return (self.exists,)


class FakeSeedCursor:
    def __init__(self):
        self.statements: list[str] = []

    @staticmethod
    def _check(statement: str, params) -> None:
        if params is not None:
            expected = statement.count("%s")
            actual = len(params)
            if expected != actual:
                raise AssertionError(f"SQL expects {expected} parameters but received {actual}")

    def execute(self, statement: str, params=None) -> None:
        self._check(statement, params)
        self.statements.append(statement)

    def executemany(self, statement: str, rows) -> None:
        for row in rows:
            self._check(statement, row)
        self.statements.append(statement)


class DatabaseScriptTests(unittest.TestCase):
    def test_reconciliation_is_limited_to_known_superseded_versions(self) -> None:
        self.assertEqual(len(reconcile_migrations.SUPERSEDED_BASELINE_VERSIONS), 16)
        self.assertEqual(
            reconcile_migrations.SUCCESSOR_BY_VERSION["20260812002200"],
            "20260812002300",
        )
        self.assertNotIn("20260813001000", reconcile_migrations.SUPERSEDED_BASELINE_VERSIONS)

    def test_public_environment_allows_generic_runtime_configuration(self) -> None:
        violations, missing = check_public_env.inspect_environment((), {})
        self.assertEqual(violations, [])
        self.assertEqual(missing, [])

        violations, missing = check_public_env.inspect_environment((), {
            "VITE_SUPABASE_URL": "https://example.supabase.co",
            "VITE_SUPABASE_ANON_KEY": "public-key",
        })
        self.assertEqual(violations, [])
        self.assertEqual(missing, [])

    def test_public_environment_rejects_renderer_secrets_from_ci(self) -> None:
        violations, _ = check_public_env.inspect_environment((), {
            "VITE_SUPABASE_URL": "https://example.supabase.co",
            "VITE_SUPABASE_ANON_KEY": "public-key",
            "VITE_SUPABASE_SERVICE_ROLE_KEY": "must-not-be-bundled",
        })
        self.assertEqual(violations, ["environment:VITE_SUPABASE_SERVICE_ROLE_KEY"])

    def test_reset_baseline_has_required_application_rows(self) -> None:
        self.assertEqual(reset_db.BASELINE_TABLE_COUNTS, {"currencies": 4, "system_settings": 1})
        self.assertEqual({row[0] for row in reset_db.BASELINE_CURRENCIES}, {"USD", "SAR", "SDG", "EGP"})

    def test_reset_refuses_schema_without_first_admin_protection(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "First-admin protection"):
            reset_db.verify_first_user_trigger(FakeTriggerCursor(False))
        reset_db.verify_first_user_trigger(FakeTriggerCursor(True))

    def test_reset_admin_password_policy(self) -> None:
        reset_db.validate_admin_credentials("owner@example.com", "StrongPass1")
        with self.assertRaises(RuntimeError):
            reset_db.validate_admin_credentials("owner@example.com", "weak")

    def test_seed_password_policy(self) -> None:
        seed_db.validate_credentials("admin@example.com", "StrongPass1")
        for password in ("short1A", "alllowercase1", "ALLUPPERCASE1", "NoDigitsHere"):
            with self.subTest(password=password), self.assertRaises(RuntimeError):
                seed_db.validate_credentials("admin@example.com", password)

    def test_seed_rejects_invalid_email(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "valid email"):
            seed_db.validate_credentials("not-an-email", "StrongPass1")

    def test_seed_valuation_matches_renderer_contract(self) -> None:
        value = json.loads(seed_db.valuation(125.5))
        self.assertEqual(value["originalAmount"], 125.5)
        self.assertEqual(value["accountingAmount"], 125.5)
        self.assertEqual(value["originalCurrency"], "USD")
        self.assertEqual(value["accountingCurrency"], "USD")
        self.assertEqual(value["rateSource"], "default")

    def test_seed_expected_counts_cover_key_workflows(self) -> None:
        for table in ("users", "shipments", "weapons", "ammunition", "accessories", "invoices", "payment_records"):
            self.assertGreater(seed_db.EXPECTED_COUNTS[table], 0)

    def test_seed_sql_parameter_contracts(self) -> None:
        cursor = FakeSeedCursor()
        seed_db.insert_demo_data(
            cursor,
            "00000000-0000-0000-0000-000000000001",
            "USR-DEMO-ADMIN",
            "Demo Admin",
            "admin@example.com",
            create_profile=True,
        )
        joined = "\n".join(cursor.statements)
        self.assertIn("insert into public.weapons", joined)
        self.assertIn("insert into public.invoices", joined)
        self.assertIn("insert into public.payment_records", joined)


if __name__ == "__main__":
    unittest.main()
