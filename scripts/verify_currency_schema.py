import pathlib
import re
import sqlite3


compiled_schema = pathlib.Path("dist-electron/src/lib/db/schema.js").read_text(encoding="utf-8")


def extract(name: str) -> str:
    match = re.search(rf"export const {name} = `(.*?)`;", compiled_schema, re.DOTALL)
    if not match:
        raise RuntimeError(f"Cannot find compiled SQL constant: {name}")
    return match.group(1)


database = sqlite3.connect(":memory:")
database.execute("PRAGMA foreign_keys = ON")
database.executescript(extract("CREATE_TABLES_SQL"))
database.executescript(extract("SEED_MASTER_DATA_SQL"))

required_columns = {
    "invoices": {
        "currency", "accounting_currency", "exchange_rate", "exchange_rate_date",
        "rate_source", "total_original_accounting", "total_negotiated_accounting",
        "total_paid_accounting", "balance_accounting", "tax_amount_accounting",
    },
    "payment_records": {
        "currency", "accounting_amount", "accounting_currency", "exchange_rate",
        "exchange_rate_date", "rate_source", "rate_id",
    },
    "weapons": {
        "purchase_price_valuation", "retail_price_valuation",
        "wholesale_price_valuation", "actual_final_price_valuation",
        "sale_price_valuation",
    },
}

for table, expected in required_columns.items():
    actual = {row[1] for row in database.execute(f"PRAGMA table_info({table})")}
    missing = expected - actual
    if missing:
        raise RuntimeError(f"{table} is missing columns: {sorted(missing)}")

for table in ("financial_data_issues", "inventory_transactions"):
    if not database.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone():
        raise RuntimeError(f"Missing table: {table}")

foreign_key_errors = list(database.execute("PRAGMA foreign_key_check"))
if foreign_key_errors:
    raise RuntimeError(f"Foreign-key errors: {foreign_key_errors}")

print({
    "sqlite": sqlite3.sqlite_version,
    "financial_tables_verified": len(required_columns),
    "foreign_key_errors": len(foreign_key_errors),
})
database.close()
