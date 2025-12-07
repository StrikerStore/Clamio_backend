# Database Migration Guide

## Overview

The application includes automatic database migrations that run on server startup. These migrations are **idempotent** (safe to run multiple times) and will automatically:

1. Create the `store_info` table if it doesn't exist
2. Create a default "Striker Store" from environment variables (if provided)
3. Add `account_code` column to all related tables
4. Migrate existing data to use the default account code
5. Set proper constraints (NOT NULL, indexes)

## Automatic Migrations

### How It Works

When the server starts, it automatically runs the migration script (`backend/utils/migrationRunner.js`). The migration:

- ✅ **Is idempotent**: Safe to run multiple times without issues
- ✅ **Is non-blocking**: Server continues to start even if migration has warnings
- ✅ **Is automatic**: No manual intervention needed in most cases
- ✅ **Is safe**: Won't delete or modify existing data unnecessarily

### Enabling/Disabling Automatic Migrations

By default, migrations run automatically on server startup. To disable:

```bash
# In your .env file
RUN_MIGRATIONS=false
```

**When to disable:**
- If you want to run migrations manually
- If you're using a separate migration tool
- If you need more control over when migrations run

## Manual Migration

If you prefer to run migrations manually, you can use the standalone migration script:

```bash
# From the backend directory
node scripts/migrate-multi-store.js
```

This script will:
1. Run all migration steps
2. Exit with code 0 on success
3. Exit with code 1 on failure

## Production Deployment

### Recommended Approach

**For new deployments:**
1. Deploy the code with migrations enabled (default)
2. The server will automatically run migrations on first startup
3. Check server logs to confirm migration completed successfully

**For existing deployments:**
1. The migration is idempotent, so it's safe to deploy
2. Existing data will be preserved
3. New `account_code` columns will be added
4. Existing records will be tagged with the default account code

### Environment Variables Required

For the default "Striker Store" to be created automatically, ensure these are set in your `.env`:

```bash
SHIPWAY_USERNAME=your_username
SHIPWAY_PASSWORD=your_password
SHIPWAY_BASIC_AUTH_HEADER=Basic xxxxxx
SHOPIFY_STORE_URL=https://your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=your_token
ENCRYPTION_KEY=your_64_character_hex_key
```

**Note:** If these are not set, the migration will still run successfully, but the default store won't be created. You can add stores manually via the superadmin panel.

### Verification

After deployment, check the server logs for:

```
🎉 ========================================
   MIGRATION COMPLETED SUCCESSFULLY!
========================================
✅ All database changes applied
🚀 Application ready for multi-store!
```

### Troubleshooting

**Migration fails on startup:**
- Check database connection settings
- Verify all required environment variables are set
- Check server logs for specific error messages
- Run migration manually: `node scripts/migrate-multi-store.js`

**Migration warnings:**
- Some warnings are normal (e.g., "column already exists")
- Server will continue to start even with warnings
- Review logs to determine if action is needed

**Tables don't exist:**
- This is normal on first deployment
- Migration will create tables as needed
- Some tables may be created by other parts of the application

## Migration Steps

The migration performs these steps in order:

1. **Create `store_info` table** - Stores multi-store configuration
2. **Create default store** - From environment variables (if provided)
3. **Add `account_code` column** - To all related tables:
   - `orders`
   - `claims`
   - `carriers`
   - `customer_info`
   - `labels`
   - `order_tracking`
   - `products`
4. **Update existing data** - Tag all existing records with default account code
5. **Set constraints** - Make `account_code` NOT NULL and add indexes

## Rollback

**Important:** This migration does not include a rollback script. If you need to rollback:

1. The `account_code` columns can be removed manually:
   ```sql
   ALTER TABLE orders DROP COLUMN account_code;
   -- Repeat for other tables
   ```

2. The `store_info` table can be dropped:
   ```sql
   DROP TABLE IF EXISTS store_info;
   ```

**Warning:** Rolling back will remove multi-store functionality. Only rollback if absolutely necessary.

## Best Practices

1. **Test migrations in staging first** - Always test migrations in a staging environment before production
2. **Backup database** - Always backup your database before running migrations in production
3. **Monitor logs** - Check server logs after deployment to ensure migrations completed
4. **Verify data** - After migration, verify that existing data has been properly tagged with account codes
5. **Keep migrations enabled** - Unless you have a specific reason, keep `RUN_MIGRATIONS=true`

## Support

If you encounter issues with migrations:

1. Check server logs for detailed error messages
2. Verify all environment variables are set correctly
3. Ensure database user has proper permissions (CREATE, ALTER, INSERT, UPDATE)
4. Try running the migration manually to see detailed output
5. Contact support with specific error messages from logs

