"""
Database wipe / factory reset engine for ShoeDZ Desktop.

Provides secure routines to either:
1. 'all': Complete Factory Reset — wipes all tenant data, inventory, sales, clients, suppliers,
   and settings, returning the application to the First-Run Setup Wizard (/setup).
   Preserves wilayas/communes, django migrations, and machine license state.
2. 'transactions_only': Operational Purge — wipes sales, receipts, invoices, stock movements,
   cash sessions, and debts while preserving the product catalog, sizes, prices, and users.
"""
import logging
import os
import shutil
from pathlib import Path

from django.conf import settings
from django.db import connection

logger = logging.getLogger(__name__)

EXCLUDED_SYSTEM_TABLES = {
    "django_migrations",
    "django_content_type",
    "auth_permission",
    "auth_group",
    "auth_group_permissions",
    "core_wilaya",
    "core_commune",
    "licensing_licensestate",
}

TRANSACTION_TABLE_NAMES = [
    # Sales & Cash
    "sales_saleitem",
    "sales_payment",
    "sales_returnitem",
    "sales_return",
    "sales_exchangenewitem",
    "sales_exchangereturnitem",
    "sales_exchange",
    "sales_sale",
    "sales_cashmovement",
    "sales_cashreconciliation",
    "sales_cashsession",
    # Invoicing
    "invoicing_invoicepayment",
    "invoicing_invoiceline",
    "invoicing_invoice",
    "invoicing_deliverynoteline",
    "invoicing_deliverynote",
    "invoicing_creditnote",
    "invoicing_invoicecounter",
    # Inventory transactions
    "inventory_stockmovement",
    "inventory_stocktransfer",
    "inventory_defectitem",
    "inventory_stocktakeitem",
    "inventory_stocktakesession",
    "inventory_cartonorder",
    # Clients ledger & cheques
    "clients_clientledger",
    "clients_cheque",
    # Suppliers transactions
    "suppliers_supplierpayment",
    "suppliers_supplierinvoice",
    "suppliers_poline",
    "suppliers_purchaseorder",
    "suppliers_supplierreturnclaim",
    # Loyalty & Promos transactions
    "loyalty_loyaltytransaction",
    # Logs & Notifications
    "core_auditlog",
    "notifications_notification",
    "core_syncoutbox",
    # Auth sessions
    "django_session",
    "token_blacklist_blacklistedtoken",
    "token_blacklist_outstandingtoken",
]


def clean_media_files():
    """Remove user-uploaded media (products, avatars, receipts) safely."""
    media_root = getattr(settings, "MEDIA_ROOT", None)
    if not media_root or not os.path.exists(media_root):
        return

    media_path = Path(media_root)
    for item in media_path.iterdir():
        try:
            if item.is_dir():
                shutil.rmtree(item)
            elif item.is_file() and not item.name.startswith("."):
                item.unlink()
        except Exception as e:
            logger.warning("Could not delete media item %s: %s", item, e)


def perform_database_wipe(mode: str = "all") -> dict:
    """
    Executes database reset according to mode ('all' or 'transactions_only').
    Returns summary dictionary with counts of cleared tables.
    """
    all_existing_tables = set(connection.introspection.table_names())
    cleared_tables = []

    logger.info("Starting database wipe in mode: %s (vendor=%s)", mode, connection.vendor)

    if connection.vendor == "sqlite":
        with connection.cursor() as cursor:
            cursor.execute("PRAGMA foreign_keys = OFF;")

            if mode == "all":
                for table in all_existing_tables:
                    if table in EXCLUDED_SYSTEM_TABLES or table.startswith("sqlite_"):
                        continue
                    cursor.execute(f'DELETE FROM "{table}";')
                    cleared_tables.append(table)
                    try:
                        cursor.execute("DELETE FROM sqlite_sequence WHERE name = %s;", [table])
                    except Exception:
                        pass
                clean_media_files()

            elif mode == "transactions_only":
                for table in TRANSACTION_TABLE_NAMES:
                    if table in all_existing_tables:
                        cursor.execute(f'DELETE FROM "{table}";')
                        cleared_tables.append(table)
                        try:
                            cursor.execute("DELETE FROM sqlite_sequence WHERE name = %s;", [table])
                        except Exception:
                            pass

                # Reset variant stocks and client debts to 0
                if "inventory_variant" in all_existing_tables:
                    cursor.execute("UPDATE inventory_variant SET stock_qty = 0;")
                if "clients_client" in all_existing_tables:
                    try:
                        cursor.execute("UPDATE clients_client SET balance = 0;")
                    except Exception:
                        pass
                if "loyalty_loyaltyaccount" in all_existing_tables:
                    try:
                        cursor.execute("UPDATE loyalty_loyaltyaccount SET points_balance = 0, total_spent = 0;")
                    except Exception:
                        pass

            cursor.execute("PRAGMA foreign_keys = ON;")
            try:
                cursor.execute("VACUUM;")
            except Exception:
                pass

    elif connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            if mode == "all":
                tables_to_truncate = [
                    f'"{t}"'
                    for t in all_existing_tables
                    if t not in EXCLUDED_SYSTEM_TABLES and not t.startswith("pg_")
                ]
                if tables_to_truncate:
                    cursor.execute(f"TRUNCATE TABLE {', '.join(tables_to_truncate)} RESTART IDENTITY CASCADE;")
                    cleared_tables.extend(tables_to_truncate)
                clean_media_files()

            elif mode == "transactions_only":
                tables_to_truncate = [
                    f'"{t}"' for t in TRANSACTION_TABLE_NAMES if t in all_existing_tables
                ]
                if tables_to_truncate:
                    cursor.execute(f"TRUNCATE TABLE {', '.join(tables_to_truncate)} RESTART IDENTITY CASCADE;")
                    cleared_tables.extend(tables_to_truncate)

                if "inventory_variant" in all_existing_tables:
                    cursor.execute("UPDATE inventory_variant SET stock_qty = 0;")
                if "clients_client" in all_existing_tables:
                    try:
                        cursor.execute("UPDATE clients_client SET balance = 0;")
                    except Exception:
                        pass
                if "loyalty_loyaltyaccount" in all_existing_tables:
                    try:
                        cursor.execute("UPDATE loyalty_loyaltyaccount SET points_balance = 0, total_spent = 0;")
                    except Exception:
                        pass

    else:
        raise NotImplementedError(f"Database vendor '{connection.vendor}' not supported for reset.")

    logger.info("Database wipe completed successfully: %d tables cleared.", len(cleared_tables))
    return {
        "mode": mode,
        "cleared_tables_count": len(cleared_tables),
        "cleared_tables": cleared_tables,
    }
