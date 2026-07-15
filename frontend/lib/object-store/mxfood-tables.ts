/**
 * Canonical list of mxfood tutorial tables.
 *
 * Must stay in sync with the `files` entries on the tutorial-mode `static`
 * DATASET doc in `lib/database/workspace-template.json`. Used by:
 *   - `AuthModule.register` to seed parquets at workspace creation
 *   - `POST /api/admin/reset-tutorial` to re-seed parquets on reset
 */
export const MXFOOD_TABLES = [
  'ad_campaigns',
  'ad_spend',
  'attribution',
  'deliveries',
  'drivers',
  'events',
  'marketing_channels',
  'order_items',
  'orders',
  'product_categories',
  'product_subcategories',
  'products',
  'promo_codes',
  'promo_usage',
  'restaurants',
  'subscription_plans',
  'support_tickets',
  'user_subscriptions',
  'users',
  'zones',
] as const;
