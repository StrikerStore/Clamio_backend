# Production Migration Integration

## Overview
The production database migration script has been integrated into the main server code to run automatically on server startup.

## How It Works

### 1. Automatic Execution
- The migration script runs **automatically** when the server starts
- It runs **BEFORE** other database operations
- It checks if migration has already been completed (idempotent)

### 2. Environment Flag Control
Add this to your `.env` file to control migration execution:

```env
# Production Database Migration
# Set to 'false' to disable migration on server startup
# Default: true (migration will run on first startup)
RUN_PROD_MIGRATION=true
```

**To disable migration:**
```env
RUN_PROD_MIGRATION=false
```

### 3. Migration Flow

```
Server Startup
    ↓
Check RUN_PROD_MIGRATION flag
    ↓
If true → Run Production Migration
    ↓
Check if already completed
    ↓
If not completed → Execute migration
    ↓
Mark as completed
    ↓
Continue with normal server startup
```

## What the Migration Does

1. ✅ Creates 2 new tables: `store_info`, `wh_mapping`
2. ✅ Adds `account_code` column to 7 tables:
   - `carriers`
   - `products`
   - `orders`
   - `claims`
   - `labels`
   - `customer_info`
   - `order_tracking`
3. ✅ Creates Striker Store entry in `store_info` table
4. ✅ Migrates all existing data to `account_code = 'STRI'`
5. ✅ Sets NOT NULL constraints
6. ✅ Marks migration as complete (prevents re-running)

## Safety Features

- **Idempotent**: Safe to run multiple times (checks completion status)
- **Transaction-based**: All changes in a transaction (rollback on error)
- **Non-blocking**: Server continues even if migration fails (logs error)
- **One-time execution**: Once completed, won't run again automatically

## Manual Execution

If you need to run the migration manually (outside of server startup):

```bash
cd backend
node scripts/migrate-prod-database.js
```

## Verification

After migration completes, check the `utility` table:

```sql
SELECT * FROM utility WHERE parameter = 'prod_migration_completed';
```

If `value = 'true'`, migration has been completed.

## Troubleshooting

### Migration Already Completed
If you see:
```
✅ Migration has already been completed!
   Skipping migration (already done).
```
This is normal - the migration won't run again.

### Migration Failed
If migration fails:
1. Check the error message in server logs
2. Fix the issue
3. Manually set `prod_migration_completed = 'false'` in utility table to re-run
4. Restart server

### Disable Migration
To prevent migration from running:
```env
RUN_PROD_MIGRATION=false
```

## Files Modified

1. `backend/scripts/migrate-prod-database.js`
   - Added `runProductionMigration()` export function
   - Updated to work when called from server.js (no process.exit)

2. `backend/server.js`
   - Added migration call before other operations
   - Added env flag check (`RUN_PROD_MIGRATION`)

3. `backend/env.template`
   - Added `RUN_PROD_MIGRATION` flag documentation

## Notes

- Migration runs **once** on first server startup
- After completion, it won't run again automatically
- You can manually re-run by updating the utility table
- Migration is safe to run on production (uses transactions)

