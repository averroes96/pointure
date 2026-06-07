/**
 * ShoeDZ TypeScript types — mirrors Django models.
 * All decimal amounts are strings (JSON serialization of Python Decimal).
 */

// ─────────────────────────────────────────────
// Core
// ─────────────────────────────────────────────

export type Plan = "free" | "pro_retail" | "pro_wholesale" | "enterprise";
export type Role = "owner" | "manager" | "cashier";
export type Language = "ar" | "fr" | "en";

export interface Tenant {
  id: string;
  name: string;
  plan: Plan;
  nif: string;
  rc: string;
  ai: string;
  phone: string;
  address: string;
  wilaya: string;
  logo: string | null;
  created_at: string;
}

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: Role;
  language_preference: Language;
  phone: string;
  avatar: string | null;
  can_see_costs: boolean;
  is_active: boolean;
  tenant?: Tenant;
}

export interface Branch {
  id: number;
  name: string;
  address: string;
  wilaya: string;
  phone: string;
  is_headquarters: boolean;
  is_active: boolean;
  created_at: string;
}

// ─────────────────────────────────────────────
// Inventory
// ─────────────────────────────────────────────

export type Gender = "M" | "F" | "K" | "U";
export type Category = "sneakers" | "boots" | "sandals" | "formal" | "sport" | "kids" | "slippers" | "other";
export type Season = "all" | "summer" | "winter" | "spring_fall";

export interface Variant {
  id: number;
  product: number;
  product_name: string;
  product_sale_price: string;
  size_eu: number;
  colour: string;
  barcode: string;
  stock_qty: number;
  alert_threshold: number;
  is_active: boolean;
  is_low_stock: boolean;
  is_out_of_stock: boolean;
}

export interface Product {
  id: number;
  name: string;
  brand: string;
  reference: string;
  category: Category;
  gender: Gender;
  season: Season;
  purchase_price?: string; // Hidden from cashiers
  sale_price: string;
  margin_pct?: string;
  image: string | null;
  description: string;
  is_active: boolean;
  total_stock: number;
  has_low_stock: boolean;
  variants: Variant[];
  created_at: string;
}

export type MovementReason =
  | "sale" | "reception" | "adjustment" | "return"
  | "transfer_out" | "transfer_in" | "damaged" | "initial";

export interface StockMovement {
  id: number;
  variant: number;
  variant_str: string;
  branch: number | null;
  branch_name: string;
  quantity_delta: number;
  reason: MovementReason;
  reference_id: string;
  notes: string;
  user_email: string;
  timestamp: string;
}

export type TransferStatus = "pending" | "in_transit" | "received" | "cancelled";

export interface StockTransfer {
  id: number;
  from_branch: number;
  from_branch_name: string;
  to_branch: number;
  to_branch_name: string;
  variant: number;
  variant_str: string;
  product_name: string;
  quantity: number;
  status: TransferStatus;
  notes: string;
  created_by: number | null;
  created_by_email: string;
  received_by: number | null;
  created_at: string;
  received_at: string | null;
}

// ─────────────────────────────────────────────
// Sales
// ─────────────────────────────────────────────

export type PaymentMethod = "cash" | "cheque" | "ccp" | "virement" | "account";
export type SaleStatus = "completed" | "cancelled" | "refunded";

export interface SaleItem {
  id: number;
  variant: number;
  variant_str: string;
  quantity: number;
  unit_price: string;
  discount_amount: string;
  subtotal: string;
}

export interface Payment {
  id: number;
  amount: string;
  method: PaymentMethod;
  notes: string;
  recorded_at: string;
}

export interface Sale {
  id: number;
  branch: number | null;
  cashier: number;
  cashier_name: string;
  client: number | null;
  client_name: string | null;
  loyalty_tier: LoyaltyTier | null;
  loyalty_points: number | null;
  status: SaleStatus;
  total_amount: string;
  discount_amount: string;
  amount_paid: string;
  balance_due: string;
  receipt_number: string;
  notes: string;
  items: SaleItem[];
  payments: Payment[];
  created_at: string;
}

// ─────────────────────────────────────────────
// Clients
// ─────────────────────────────────────────────

export type ChequeStatus = "pending" | "deposited" | "bounced" | "cancelled";
export type ChequeDirection = "receivable" | "payable";

export interface Client {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  wilaya: string;
  nif: string;
  rc: string;
  credit_limit: string;
  cached_balance: string;
  is_over_credit_limit: boolean;
  is_active: boolean;
  notes: string;
  created_at: string;
}

export interface ClientLedgerEntry {
  id: number;
  entry_type: "debit" | "credit";
  amount: string;
  description: string;
  reference_type: string;
  reference_id: string;
  date: string;
  balance_after: string;
  created_at: string;
}

export interface Cheque {
  id: number;
  client: number | null;
  client_name: string;
  supplier: number | null;
  supplier_name: string;
  direction: ChequeDirection;
  number: string;
  bank: string;
  amount: string;
  due_date: string;
  status: ChequeStatus;
  days_until_due: number;
  notes: string;
  created_at: string;
}

// ─────────────────────────────────────────────
// Invoicing
// ─────────────────────────────────────────────

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "overdue" | "cancelled";

export interface DeliveryNote {
  id: number;
  invoice: number;
  invoice_number: string;
  invoice_date: string;
  client_name: string;
  invoice_total_ht: string;
  invoice_total_ttc: string;
  number: string;
  date: string;
  delivered_by: string;
  notes: string;
  created_at: string;
}

export interface CreditNote {
  id: number;
  original_invoice: number;
  original_invoice_number: string;
  original_invoice_tva_rate: string;
  client_name: string;
  number: string;
  reason: string;
  total_ht: string;
  tva_amount: string;
  total_ttc: string;
  date: string;
  created_at: string;
}

export interface InvoiceLine {
  id: number;
  variant: number | null;
  description: string;
  quantity: string;
  unit_price: string;
  discount_pct: string;
  line_total: string;
  order: number;
}

export interface InvoicePayment {
  id: number;
  amount: string;
  method: PaymentMethod;
  date: string;
  notes: string;
  recorded_by: number;
  created_at: string;
}

export interface Invoice {
  id: number;
  client: number | null;
  client_name: string;
  branch: number | null;
  number: string;
  series_prefix: string;
  date: string;
  due_date: string;
  status: InvoiceStatus;
  total_ht: string;
  tva_rate: string;
  tva_amount: string;
  total_ttc: string;
  apply_tva: boolean;
  total_paid: string;
  balance_due: string;
  notes: string;
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  has_pdf: boolean;
  created_at: string;
}

// ─────────────────────────────────────────────
// Suppliers
// ─────────────────────────────────────────────

export interface Supplier {
  id: number;
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  origin_country: string;
  payment_terms: string;
  outstanding_balance: string;
  notes: string;
  is_active: boolean;
  created_at: string;
}

export interface POLine {
  id: number;
  variant: number | null;
  variant_label: string | null;
  description: string;
  quantity_ordered: number;
  quantity_received: number;
  agreed_unit_price: string;
  line_total: string;
}

export type POStatus = "draft" | "sent" | "partial" | "received" | "cancelled";

export interface PurchaseOrder {
  id: number;
  supplier: number;
  supplier_name: string;
  status: POStatus;
  expected_date: string | null;
  reference: string;
  notes: string;
  total_amount: string;
  created_by: number | null;
  lines: POLine[];
  created_at: string;
}

export interface SupplierInvoice {
  id: number;
  supplier: number;
  supplier_name: string;
  purchase_order: number | null;
  invoice_number: string;
  date: string;
  due_date: string;
  total_amount: string;
  notes: string;
  created_at: string;
}

export interface SupplierPayment {
  id: number;
  supplier: number;
  supplier_name: string;
  supplier_invoice: number | null;
  amount: string;
  method: "cash" | "cheque" | "virement";
  cheque_number: string;
  bank: string;
  due_date: string | null;
  date: string;
  notes: string;
  recorded_by: number | null;
  created_at: string;
}

// ─────────────────────────────────────────────
// Reports / Dashboard
// ─────────────────────────────────────────────

export interface DashboardKPIs {
  today_revenue: string;
  total_outstanding_debt: string;
  low_stock_sku_count: number;
  cheques_due_this_week: number;
  as_of: string;
}

export interface SalesByPeriodRow {
  period: string;
  revenue: string;
  sale_count: number;
}

export interface BestSellerRow {
  product_id: number;
  product_name: string;
  brand: string;
  units_sold: number;
  revenue: string;
}

export interface DebtAgeingRow {
  client_id: number;
  client_name: string;
  phone: string;
  wilaya: string;
  current: string;
  days_30: string;
  days_60: string;
  days_90: string;
  days_90_plus: string;
  total: string;
}

// ─────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────

export type NotificationType = "cheque_due" | "low_stock" | "invoice_overdue" | "general";

export interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  related_object_type: string;
  related_object_id: string;
  created_at: string;
}

// ─────────────────────────────────────────────
// Loyalty
// ─────────────────────────────────────────────

export type LoyaltyTier = "bronze" | "silver" | "gold";
export type LoyaltyTransactionType = "earn" | "redeem" | "adjust" | "expire";

export interface LoyaltyProgram {
  id: number;
  points_per_100dzd: number;
  redemption_value: number;
  dzd_per_100_points: string;
  min_redemption_points: number;
  expiry_months: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LoyaltyTransaction {
  id: number;
  points: number;
  transaction_type: LoyaltyTransactionType;
  reference_type: string;
  reference_id: string;
  description: string;
  balance_after: number;
  expires_at: string | null;
  created_at: string;
}

export interface LoyaltyAccount {
  id: number;
  client: number;
  client_name: string;
  client_phone: string;
  points_balance: number;
  total_earned: number;
  tier: LoyaltyTier;
  tier_display: string;
  next_tier: LoyaltyTier | null;
  points_to_next_tier: number | null;
  enrolled_at: string;
  transactions: LoyaltyTransaction[];
}

export interface LoyaltyAccountSummary {
  id: number;
  client: number;
  client_name: string;
  points_balance: number;
  total_earned: number;
  tier: LoyaltyTier;
  tier_display: string;
  next_tier: LoyaltyTier | null;
  points_to_next_tier: number | null;
  enrolled_at: string;
}

// ─────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────

export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}
