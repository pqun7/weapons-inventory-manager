export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type PublicTableName =
  | "weapon_types" | "weapon_subtypes" | "calibers" | "subtype_calibers"
  | "brands" | "models" | "warehouses" | "storage_locations"
  | "currencies" | "exchange_rate_history" | "exchange_rate_overrides"
  | "exchange_rate_audit_log" | "users" | "suppliers" | "customers"
  | "shipments" | "weapons" | "invoices" | "payment_records"
  | "accessories" | "ammunition" | "ammunition_weapon_compatibility"
  | "accessory_weapon_compatibility" | "audit_logs" | "app_notifications"
  | "system_settings" | "saved_filters" | "user_preferences"
  | "financial_data_issues" | "inventory_transactions" | "shipment_items"
  | "product_costs" | "shipment_costs" | "shipment_cost_scope_items"
  | "shipment_cost_allocations" | "inventory_cost_snapshots" | "shipment_imports"
  | "shipment_documents" | "shipment_import_items" | "shipment_validation_issues"
  | "shipment_item_changes" | "shipment_status_history" | "migration_runs"
  | "business_id_counters"
  | "inventory_product_types"
  | "app_backups"

type GenericTable = {
  Row: Record<string, Json>
  Insert: Record<string, Json | undefined>
  Update: Record<string, Json | undefined>
  Relationships: []
}

type RpcName =
  | "complete_sale"
  | "register_payment"
  | "update_weapon_status"
  | "currency_snapshot"
  | "current_app_user_id"
  | "current_app_role"
  | "bulk_intake_weapons"
  | "create_shipment"
  | "bulk_create_shipment"
  | "receive_scheduled_shipment"
  | "reschedule_shipment"
  | "update_scheduled_shipment"
  | "adjust_inventory_stock"
  | "receive_ammunition"
  | "update_ammunition_package"
  | "extend_invoice_due_date"
  | "void_invoice"
  | "create_inventory_product"
  | "replace_product_costs"
  | "update_weapon_notes"
  | "update_weapon_location"
  | "bind_weapon_to_shipment"
  | "set_shipment_status"
  | "update_shipment_details"
  | "add_shipment_document_metadata"
  | "delete_shipment_document_metadata"
  | "update_invoice_notes"
  | "update_inventory_product"
  | "create_app_notification"
  | "write_audit_event"
  | "flag_overdue_shipments"
  | "apply_shipment_costs"
  | "append_weapon_image"
  | "add_shipment_timeline_event"
  | "delete_shipment"
  | "create_manifest_review"
  | "update_manifest_items"
  | "bulk_update_manifest_items"
  | "delete_manifest_items"
  | "update_manifest_details"
  | "delete_manifest_review"
  | "confirm_manifest_review"
  | "confirm_manifest_arrival"
  | "reschedule_manifest"
  | "cancel_manifest"
  | "create_inventory_product_type"
  | "update_customer"
  | "update_product_pricing"
  | "create_system_backup"
  | "restore_system_backup"
  | "delete_backup"
  | "update_own_email"
  | "admin_users_action"
  | "resolve_account"
  | "claim_account"

type GenericRpc = {
  Args: Record<string, Json | undefined>
  Returns: Json
}

export type Database = {
  public: {
    Tables: { [Name in PublicTableName]: GenericTable }
    Views: Record<never, never>
    Functions: { [Name in RpcName]: GenericRpc }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}
