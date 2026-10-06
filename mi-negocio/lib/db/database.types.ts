
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "activity_events": {
                  Row: {
                    "actor_id": string | null,"business_id": string,"created_at": string,"entity_id": string,"entity_type": string,"event_type": string,"id": string,"metadata": NonNullable<Json>
                  }
                  Insert: {
                    "actor_id"?: string | null,"business_id": string,"created_at"?: string,"entity_id": string,"entity_type": string,"event_type": string,"id"?: string,"metadata"?: NonNullable<Json>
                  }
                  Update: {
                    "actor_id"?: string | null,"business_id"?: string,"created_at"?: string,"entity_id"?: string,"entity_type"?: string,"event_type"?: string,"id"?: string,"metadata"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_events_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"business_members": {
                  Row: {
                    "business_id": string,"created_at": string,"role": string,"user_id": string
                  }
                  Insert: {
                    "business_id": string,"created_at"?: string,"role"?: string,"user_id": string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_members_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"businesses": {
                  Row: {
                    "created_at": string,"created_by": string | null,"currency": string,"id": string,"logo_path": string | null,"name": string,"payment_qr_label": string | null,"payment_qr_path": string | null,"pickup_address": string | null,"pickup_reference": string | null,"revision": number,"timezone": string,"updated_at": string,"whatsapp_phone": string | null
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"currency"?: string,"id"?: string,"logo_path"?: string | null,"name": string,"payment_qr_label"?: string | null,"payment_qr_path"?: string | null,"pickup_address"?: string | null,"pickup_reference"?: string | null,"revision"?: number,"timezone"?: string,"updated_at"?: string,"whatsapp_phone"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"currency"?: string,"id"?: string,"logo_path"?: string | null,"name"?: string,"payment_qr_label"?: string | null,"payment_qr_path"?: string | null,"pickup_address"?: string | null,"pickup_reference"?: string | null,"revision"?: number,"timezone"?: string,"updated_at"?: string,"whatsapp_phone"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"customers": {
                  Row: {
                    "address": string | null,"archived_at": string | null,"business_id": string,"created_at": string,"delivery_reference": string | null,"id": string,"name": string,"notes": string | null,"phone": string | null,"revision": number,"updated_at": string
                  }
                  Insert: {
                    "address"?: string | null,"archived_at"?: string | null,"business_id": string,"created_at"?: string,"delivery_reference"?: string | null,"id"?: string,"name": string,"notes"?: string | null,"phone"?: string | null,"revision"?: number,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"archived_at"?: string | null,"business_id"?: string,"created_at"?: string,"delivery_reference"?: string | null,"id"?: string,"name"?: string,"notes"?: string | null,"phone"?: string | null,"revision"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"expenses": {
                  Row: {
                    "amount_cents": number,"business_id": string,"category": string,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"idempotency_key": string,"method": string,"occurred_at": string,"receipt_path": string | null,"replaces_expense_id": string | null,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  Insert: {
                    "amount_cents": number,"business_id": string,"category": string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"idempotency_key": string,"method": string,"occurred_at": string,"receipt_path"?: string | null,"replaces_expense_id"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"business_id"?: string,"category"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"idempotency_key"?: string,"method"?: string,"occurred_at"?: string,"receipt_path"?: string | null,"replaces_expense_id"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_replaces_fk"
      columns: ["business_id","replaces_expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"inventory_movements": {
                  Row: {
                    "actor_id": string | null,"business_id": string,"created_at": string,"id": string,"movement_type": string,"on_hand_after": number,"on_hand_delta": number,"operation_key": string,"order_id": string | null,"reason": string | null,"reserved_after": number,"reserved_delta": number,"variant_id": string
                  }
                  Insert: {
                    "actor_id"?: string | null,"business_id": string,"created_at"?: string,"id"?: string,"movement_type": string,"on_hand_after": number,"on_hand_delta": number,"operation_key": string,"order_id"?: string | null,"reason"?: string | null,"reserved_after": number,"reserved_delta": number,"variant_id": string
                  }
                  Update: {
                    "actor_id"?: string | null,"business_id"?: string,"created_at"?: string,"id"?: string,"movement_type"?: string,"on_hand_after"?: number,"on_hand_delta"?: number,"operation_key"?: string,"order_id"?: string | null,"reason"?: string | null,"reserved_after"?: number,"reserved_delta"?: number,"variant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_movements_order_fk"
      columns: ["business_id","order_id"]
isOneToOne: false
      referencedRelation: "order_summaries"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "inventory_movements_order_fk"
      columns: ["business_id","order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "inventory_movements_variant_fk"
      columns: ["business_id","variant_id"]
isOneToOne: false
      referencedRelation: "product_variants"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "inventory_movements_variant_fk"
      columns: ["business_id","variant_id"]
isOneToOne: false
      referencedRelation: "variant_stock"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"order_counters": {
                  Row: {
                    "business_id": string,"last_number": number
                  }
                  Insert: {
                    "business_id": string,"last_number"?: number
                  }
                  Update: {
                    "business_id"?: string,"last_number"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_counters_business_id_fkey"
      columns: ["business_id"]
isOneToOne: true
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"order_items": {
                  Row: {
                    "business_id": string,"created_at": string,"id": string,"line_total_cents": number,"order_id": string,"position": number,"product_name": string,"quantity": number,"sku": string | null,"stock_state": string,"unit_cost_cents": number | null,"unit_price_cents": number,"variant_id": string,"variant_label": string | null
                  }
                  Insert: {
                    "business_id": string,"created_at"?: string,"id"?: string,"line_total_cents": number,"order_id": string,"position"?: number,"product_name": string,"quantity": number,"sku"?: string | null,"stock_state"?: string,"unit_cost_cents"?: number | null,"unit_price_cents": number,"variant_id": string,"variant_label"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"id"?: string,"line_total_cents"?: number,"order_id"?: string,"position"?: number,"product_name"?: string,"quantity"?: number,"sku"?: string | null,"stock_state"?: string,"unit_cost_cents"?: number | null,"unit_price_cents"?: number,"variant_id"?: string,"variant_label"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_order_fk"
      columns: ["business_id","order_id"]
isOneToOne: false
      referencedRelation: "order_summaries"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "order_items_order_fk"
      columns: ["business_id","order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "order_items_variant_fk"
      columns: ["business_id","variant_id"]
isOneToOne: false
      referencedRelation: "product_variants"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "order_items_variant_fk"
      columns: ["business_id","variant_id"]
isOneToOne: false
      referencedRelation: "variant_stock"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "business_id": string,"cancel_reason": string | null,"canceled_at": string | null,"canceled_from_status": string | null,"code": string | null,"confirmed_at": string | null,"create_idempotency_key": string,"created_at": string,"created_by": string | null,"customer_id": string | null,"customer_name": string | null,"customer_phone": string | null,"delivered_at": string | null,"delivery_address": string | null,"delivery_fee_cents": number,"delivery_reference": string | null,"discount_cents": number,"fulfillment_type": string,"id": string,"notes": string | null,"number": number,"preparing_at": string | null,"promised_date": string | null,"returned_to_stock": boolean | null,"revision": number,"status": string,"subtotal_cents": number,"time_window": string | null,"total_cents": number,"updated_at": string
                  }
                  Insert: {
                    "business_id": string,"cancel_reason"?: string | null,"canceled_at"?: string | null,"canceled_from_status"?: string | null,"code"?: never,"confirmed_at"?: string | null,"create_idempotency_key": string,"created_at"?: string,"created_by"?: string | null,"customer_id"?: string | null,"customer_name"?: string | null,"customer_phone"?: string | null,"delivered_at"?: string | null,"delivery_address"?: string | null,"delivery_fee_cents"?: number,"delivery_reference"?: string | null,"discount_cents"?: number,"fulfillment_type": string,"id"?: string,"notes"?: string | null,"number": number,"preparing_at"?: string | null,"promised_date"?: string | null,"returned_to_stock"?: boolean | null,"revision"?: number,"status"?: string,"subtotal_cents"?: number,"time_window"?: string | null,"total_cents"?: number,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"cancel_reason"?: string | null,"canceled_at"?: string | null,"canceled_from_status"?: string | null,"code"?: never,"confirmed_at"?: string | null,"create_idempotency_key"?: string,"created_at"?: string,"created_by"?: string | null,"customer_id"?: string | null,"customer_name"?: string | null,"customer_phone"?: string | null,"delivered_at"?: string | null,"delivery_address"?: string | null,"delivery_fee_cents"?: number,"delivery_reference"?: string | null,"discount_cents"?: number,"fulfillment_type"?: string,"id"?: string,"notes"?: string | null,"number"?: number,"preparing_at"?: string | null,"promised_date"?: string | null,"returned_to_stock"?: boolean | null,"revision"?: number,"status"?: string,"subtotal_cents"?: number,"time_window"?: string | null,"total_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_customer_fk"
      columns: ["business_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"business_id": string,"created_at": string,"created_by": string | null,"id": string,"idempotency_key": string,"method": string,"note": string | null,"occurred_at": string,"order_id": string,"receipt_path": string | null,"reference": string | null,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  Insert: {
                    "amount_cents": number,"business_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"idempotency_key": string,"method": string,"note"?: string | null,"occurred_at": string,"order_id": string,"receipt_path"?: string | null,"reference"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"idempotency_key"?: string,"method"?: string,"note"?: string | null,"occurred_at"?: string,"order_id"?: string,"receipt_path"?: string | null,"reference"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_order_fk"
      columns: ["business_id","order_id"]
isOneToOne: false
      referencedRelation: "order_summaries"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "payments_order_fk"
      columns: ["business_id","order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"product_variants": {
                  Row: {
                    "archived_at": string | null,"business_id": string,"color": string | null,"cost_cents": number | null,"created_at": string,"id": string,"low_stock_threshold": number,"on_hand": number,"position": number,"price_cents": number,"product_id": string,"reserved": number,"revision": number,"size": string | null,"sku": string | null,"track_inventory": boolean,"updated_at": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"business_id": string,"color"?: string | null,"cost_cents"?: number | null,"created_at"?: string,"id"?: string,"low_stock_threshold"?: number,"on_hand"?: number,"position"?: number,"price_cents": number,"product_id": string,"reserved"?: number,"revision"?: number,"size"?: string | null,"sku"?: string | null,"track_inventory"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"business_id"?: string,"color"?: string | null,"cost_cents"?: number | null,"created_at"?: string,"id"?: string,"low_stock_threshold"?: number,"on_hand"?: number,"position"?: number,"price_cents"?: number,"product_id"?: string,"reserved"?: number,"revision"?: number,"size"?: string | null,"sku"?: string | null,"track_inventory"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_variants_product_fk"
      columns: ["business_id","product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"products": {
                  Row: {
                    "archived_at": string | null,"business_id": string,"category": string | null,"created_at": string,"description": string | null,"id": string,"image_path": string | null,"name": string,"revision": number,"updated_at": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"business_id": string,"category"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"image_path"?: string | null,"name": string,"revision"?: number,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"business_id"?: string,"category"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"image_path"?: string | null,"name"?: string,"revision"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string,"id": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"display_name": string,"id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"refunds": {
                  Row: {
                    "amount_cents": number,"business_id": string,"created_at": string,"created_by": string | null,"id": string,"idempotency_key": string,"method": string,"occurred_at": string,"order_id": string,"payment_id": string,"reason": string,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  Insert: {
                    "amount_cents": number,"business_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"idempotency_key": string,"method": string,"occurred_at": string,"order_id": string,"payment_id": string,"reason": string,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"idempotency_key"?: string,"method"?: string,"occurred_at"?: string,"order_id"?: string,"payment_id"?: string,"reason"?: string,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "refunds_payment_fk"
      columns: ["business_id","order_id","payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["business_id","order_id","id"]
    }
                  ]
                }
          }
          Views: {
            "order_summaries": {
                  Row: {
                    "balance_due_cents": number | null,"business_id": string | null,"cancel_reason": string | null,"canceled_at": string | null,"canceled_from_status": string | null,"code": string | null,"confirmed_at": string | null,"create_idempotency_key": string | null,"created_at": string | null,"created_by": string | null,"customer_id": string | null,"customer_name": string | null,"customer_phone": string | null,"delivered_at": string | null,"delivery_address": string | null,"delivery_fee_cents": number | null,"delivery_reference": string | null,"discount_cents": number | null,"fulfillment_type": string | null,"id": string | null,"is_collectible": boolean | null,"net_paid_cents": number | null,"notes": string | null,"number": number | null,"paid_cents": number | null,"payment_state": string | null,"preparing_at": string | null,"promised_date": string | null,"refund_due_cents": number | null,"refunded_cents": number | null,"returned_to_stock": boolean | null,"revision": number | null,"status": string | null,"subtotal_cents": number | null,"time_window": string | null,"total_cents": number | null,"updated_at": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_customer_fk"
      columns: ["business_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"variant_stock": {
                  Row: {
                    "archived_at": string | null,"available": number | null,"business_id": string | null,"color": string | null,"cost_cents": number | null,"created_at": string | null,"id": string | null,"is_low_stock": boolean | null,"is_out_of_stock": boolean | null,"low_stock_threshold": number | null,"on_hand": number | null,"position": number | null,"price_cents": number | null,"product_id": string | null,"reserved": number | null,"revision": number | null,"size": string | null,"sku": string | null,"track_inventory": boolean | null,"updated_at": string | null
                  }
                  Insert: {
                           "archived_at"?: string | null,"available"?: never,"business_id"?: string | null,"color"?: string | null,"cost_cents"?: number | null,"created_at"?: string | null,"id"?: string | null,"is_low_stock"?: never,"is_out_of_stock"?: never,"low_stock_threshold"?: number | null,"on_hand"?: number | null,"position"?: number | null,"price_cents"?: number | null,"product_id"?: string | null,"reserved"?: number | null,"revision"?: number | null,"size"?: string | null,"sku"?: string | null,"track_inventory"?: boolean | null,"updated_at"?: string | null
                         }
                        Update: {
                           "archived_at"?: string | null,"available"?: never,"business_id"?: string | null,"color"?: string | null,"cost_cents"?: number | null,"created_at"?: string | null,"id"?: string | null,"is_low_stock"?: never,"is_out_of_stock"?: never,"low_stock_threshold"?: number | null,"on_hand"?: number | null,"position"?: number | null,"price_cents"?: number | null,"product_id"?: string | null,"reserved"?: number | null,"revision"?: number | null,"size"?: string | null,"sku"?: string | null,"track_inventory"?: boolean | null,"updated_at"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "product_variants_product_fk"
      columns: ["business_id","product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["business_id","id"]
    }
                  ]
                }
          }
          Functions: {
            "adjust_stock":
{ Args: { "p_delta": number,"p_operation_key": string,"p_reason": string,"p_variant_id": string }; Returns: Json
                           },
"cancel_order":
{ Args: { "p_expected_revision": number,"p_order_id": string,"p_reason": string,"p_returned_to_stock"?: boolean }; Returns: undefined
                           },
"cash_entries":
{ Args: { "p_end": string,"p_limit"?: number,"p_offset"?: number,"p_start": string }; Returns: {
              "amount_cents": number,"category": string,"customer_name": string,"description": string,"has_receipt": boolean,"id": string,"kind": string,"method": string,"occurred_at": string,"order_code": string,"order_id": string,"total_count": number,"void_reason": string,"voided_at": string
            }[]
                           },
"cash_summary":
{ Args: { "p_end": string,"p_start": string }; Returns: Json
                           },
"confirm_order":
{ Args: { "p_expected_revision": number,"p_order_id": string }; Returns: undefined
                           },
"correct_expense":
{ Args: { "p_amount_cents": number,"p_category": string,"p_description": string,"p_expense_id": string,"p_idempotency_key": string,"p_method": string,"p_occurred_at": string,"p_reason": string }; Returns: string
                           },
"create_business":
{ Args: { "p_business_name": string,"p_display_name": string,"p_pickup_address"?: string,"p_pickup_reference"?: string,"p_whatsapp_phone"?: string }; Returns: string
                           },
"create_order":
{ Args: { "p_confirm": boolean,"p_idempotency_key": string,"p_input": Json,"p_payment": Json }; Returns: string
                           },
"customer_totals":
{ Args: { "p_customer_id": string }; Returns: {
              "balance_due_cents": number,"net_paid_cents": number,"order_count": number,"refund_due_cents": number
            }[]
                           },
"dashboard_summary":
{ Args: { "p_end": string,"p_start": string,"p_today": string }; Returns: Json
                           },
"list_customers":
{ Args: { "p_archived"?: boolean,"p_limit"?: number,"p_offset"?: number,"p_search"?: string,"p_with_balance"?: boolean }; Returns: {
              "archived_at": string,"balance_due_cents": number,"id": string,"name": string,"order_count": number,"phone": string,"total_count": number
            }[]
                           },
"list_orders":
{ Args: { "p_customer_id"?: string,"p_from"?: string,"p_fulfillment_type"?: string,"p_limit"?: number,"p_offset"?: number,"p_payment_state"?: string,"p_quick"?: string,"p_search"?: string,"p_sort"?: string,"p_status"?: string,"p_to"?: string,"p_today"?: string }; Returns: {
              "balance_due_cents": number,"code": string,"confirmed_at": string,"created_at": string,"customer_id": string,"customer_name": string,"customer_phone": string,"fulfillment_type": string,"id": string,"net_paid_cents": number,"number": number,"payment_state": string,"promised_date": string,"refund_due_cents": number,"status": string,"time_window": string,"total_cents": number,"total_count": number
            }[]
                           },
"list_products":
{ Args: { "p_archived"?: boolean,"p_limit"?: number,"p_low_stock"?: boolean,"p_offset"?: number,"p_search"?: string }; Returns: {
              "archived_at": string,"category": string,"id": string,"image_path": string,"name": string,"total_count": number,"variants": Json
            }[]
                           },
"log_share_opened":
{ Args: { "p_kind": string,"p_order_id": string }; Returns: undefined
                           },
"mark_order_delivered":
{ Args: { "p_expected_revision": number,"p_order_id": string }; Returns: undefined
                           },
"mark_order_preparing":
{ Args: { "p_expected_revision": number,"p_order_id": string }; Returns: undefined
                           },
"record_expense":
{ Args: { "p_amount_cents": number,"p_category": string,"p_description": string,"p_idempotency_key": string,"p_method": string,"p_occurred_at": string,"p_receipt_path": string }; Returns: string
                           },
"record_payment":
{ Args: { "p_amount_cents": number,"p_idempotency_key": string,"p_method": string,"p_note": string,"p_occurred_at": string,"p_order_id": string,"p_receipt_path": string,"p_reference": string }; Returns: string
                           },
"record_refund":
{ Args: { "p_amount_cents": number,"p_idempotency_key": string,"p_method": string,"p_occurred_at": string,"p_payment_id": string,"p_reason": string }; Returns: string
                           },
"save_customer":
{ Args: { "p_input": Json }; Returns: string
                           },
"save_product":
{ Args: { "p_input": Json }; Returns: string
                           },
"search_sellable_variants":
{ Args: { "p_limit"?: number,"p_search"?: string }; Returns: {
              "available": number,"color": string,"price_cents": number,"product_id": string,"product_name": string,"size": string,"sku": string,"track_inventory": boolean,"variant_id": string
            }[]
                           },
"set_business_asset":
{ Args: { "p_kind": string,"p_path": string }; Returns: string
                           },
"set_customer_archived":
{ Args: { "p_archived": boolean,"p_customer_id": string }; Returns: undefined
                           },
"set_product_archived":
{ Args: { "p_archived": boolean,"p_product_id": string }; Returns: undefined
                           },
"update_business":
{ Args: { "p_expected_revision": number,"p_input": Json }; Returns: number
                           },
"update_order_draft":
{ Args: { "p_expected_revision": number,"p_input": Json,"p_order_id": string }; Returns: number
                           },
"update_order_logistics":
{ Args: { "p_expected_revision": number,"p_input": Json,"p_order_id": string }; Returns: number
                           },
"update_profile":
{ Args: { "p_display_name": string }; Returns: undefined
                           },
"void_expense":
{ Args: { "p_expense_id": string,"p_reason": string }; Returns: undefined
                           },
"void_payment":
{ Args: { "p_payment_id": string,"p_reason": string }; Returns: undefined
                           },
"void_refund":
{ Args: { "p_reason": string,"p_refund_id": string }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
