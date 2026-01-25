# Database Migration Comparison: Commit 66b9786 → Current

## Summary
This document compares the database structure from commit `66b9786` with the current structure to ensure the migration script covers all changes.

---

## Tables Comparison

### Tables in Commit 66b9786:
1. ✅ `utility` - Already exists (no changes needed)
2. ✅ `carriers` - Already exists (needs account_code column)
3. ✅ `products` - Already exists (needs account_code column)
4. ✅ `users` - Already exists (no changes needed)
5. ✅ `settlements` - Already exists (no changes needed)
6. ✅ `transactions` - Already exists (no changes needed)
7. ✅ `orders` - Already exists (needs account_code column)
8. ✅ `labels` - Already exists (needs account_code column)
9. ✅ `order_tracking` - Already exists (needs account_code column)
10. ✅ `customer_info` - Already exists (needs account_code column)
11. ✅ `claims` - Already exists (needs account_code column)
12. ✅ `notifications` - Already exists (no changes needed)
13. ✅ `notification_views` - Already exists (no changes needed)
14. ✅ `push_subscriptions` - Already exists (no changes needed)
15. ✅ `push_notification_logs` - Already exists (no changes needed)

### NEW Tables (Added after 66b9786):
1. ❌ **`store_info`** - **MUST BE CREATED** ✅ Covered in migration script
2. ❌ **`wh_mapping`** - **MUST BE CREATED** ✅ Covered in migration script

---

## Columns Comparison

### Columns that already existed in 66b9786 (DO NOT ADD):
- ✅ `orders.size` - Already exists
- ✅ `orders.is_partial_paid` - Already exists
- ✅ `products.sku_id` - Already exists
- ✅ `products.created_at` - Already exists
- ✅ `products.updated_at` - Already exists
- ✅ `claims.priority_carrier` - Already exists

### NEW Columns (Added after 66b9786):

#### `account_code` column - MUST BE ADDED to:
1. ✅ `carriers.account_code` - ✅ Covered in migration script
2. ✅ `products.account_code` - ✅ Covered in migration script
3. ✅ `orders.account_code` - ✅ Covered in migration script
4. ✅ `claims.account_code` - ✅ Covered in migration script
5. ✅ `labels.account_code` - ✅ Covered in migration script
6. ✅ `customer_info.account_code` - ✅ Covered in migration script
7. ✅ `order_tracking.account_code` - ✅ Covered in migration script

---

## Data Migration Required

### 1. Create Striker Store Entry
- ✅ Create entry in `store_info` table with account_code = 'STRI'
- ✅ Covered in migration script

### 2. Migrate Existing Data
- ✅ Set `account_code = 'STRI'` for all existing rows in:
  - `carriers` ✅
  - `products` ✅
  - `orders` ✅
  - `claims` ✅
  - `labels` ✅
  - `customer_info` ✅
  - `order_tracking` ✅
- ✅ Covered in migration script

### 3. Set NOT NULL Constraints
- ✅ After data migration, set `account_code` as NOT NULL in all 7 tables
- ✅ Covered in migration script

---

## Migration Script Coverage

### ✅ Step 1: Create New Tables
- [x] `store_info` table
- [x] `wh_mapping` table

### ✅ Step 2: Add account_code Column
- [x] `carriers`
- [x] `products`
- [x] `orders`
- [x] `claims`
- [x] `labels`
- [x] `customer_info`
- [x] `order_tracking`

### ✅ Step 3: Create Striker Store
- [x] Create store_info entry with account_code = 'STRI'

### ✅ Step 4: Migrate Data
- [x] Update all existing rows to account_code = 'STRI'

### ✅ Step 5: Set NOT NULL Constraints
- [x] Set account_code as NOT NULL in all 7 tables

### ✅ Step 6: Mark Migration Complete
- [x] Update utility table to prevent re-running

---

## Verification

✅ **All changes from commit 66b9786 to current are covered in the migration script!**

The migration script (`backend/scripts/migrate-prod-database.js`) includes:
1. ✅ Creation of 2 new tables (store_info, wh_mapping)
2. ✅ Addition of account_code to 7 existing tables
3. ✅ Data migration to set account_code = 'STRI'
4. ✅ Creation of Striker Store entry
5. ✅ Setting NOT NULL constraints
6. ✅ One-time execution protection

**The script is complete and ready for production use!**

