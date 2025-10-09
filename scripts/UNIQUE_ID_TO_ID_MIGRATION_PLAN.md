# Migration Plan: Replace unique_id with id in Orders Table

## Overview
This document outlines the complete migration plan to replace the `unique_id` column with the `id` column as the primary identifier in the orders table.

## Current State
- **Orders Table**: Has both `id` (VARCHAR(50) PRIMARY KEY) and `unique_id` (VARCHAR(100) UNIQUE)
- **Claims Table**: References `order_unique_id` which maps to `unique_id` in orders
- **Codebase**: Uses `unique_id` extensively for order identification

## Migration Steps

### Phase 1: Database Migration
1. **Run Migration Script**: `node backend/scripts/migrate-unique-id-to-id.js`
   - Copies `unique_id` values to `id` where `id` is null/empty
   - Updates claims table references
   - Removes `unique_id` column
   - Updates indexes

### Phase 2: Backend Code Updates

#### Database Layer (`backend/config/database.js`)
- [ ] Update `getOrderByUniqueId()` → `getOrderById()`
- [ ] Update `updateOrder()` to use `id` instead of `unique_id`
- [ ] Update all SQL queries to use `id` instead of `unique_id`
- [ ] Update `createOrder()` to not set `unique_id`

#### Services (`backend/services/`)
- [ ] Update `shipwayService.js` to use `id` instead of `unique_id`
- [ ] Update order creation logic
- [ ] Update order update logic

#### Controllers (`backend/controllers/`)
- [ ] Update `userController.js` order operations
- [ ] Update any other controllers using `unique_id`

#### Routes (`backend/routes/`)
- [ ] Update `orders.js` to use `id` instead of `unique_id`
- [ ] Update API endpoints
- [ ] Update request/response handling

### Phase 3: Frontend Code Updates

#### API Client (`frontend/lib/api.ts`)
- [ ] Update all API methods to use `id` instead of `unique_id`
- [ ] Update parameter names in API calls
- [ ] Update response handling

#### Components
- [ ] Update `admin-dashboard.tsx` to use `id` instead of `unique_id`
- [ ] Update `vendor-dashboard.tsx` to use `id` instead of `unique_id`
- [ ] Update all order selection logic
- [ ] Update all order operation calls

### Phase 4: Testing
- [ ] Test order creation
- [ ] Test order updates
- [ ] Test order claiming/unclaiming
- [ ] Test bulk operations
- [ ] Test admin panel functionality
- [ ] Test vendor panel functionality

## Files to Update

### Backend Files
```
backend/config/database.js
backend/services/shipwayService.js
backend/controllers/userController.js
backend/routes/orders.js
```

### Frontend Files
```
frontend/lib/api.ts
frontend/components/admin/admin-dashboard.tsx
frontend/components/vendor/vendor-dashboard.tsx
```

## Risk Assessment
- **High Risk**: This is a breaking change that affects core functionality
- **Data Loss Risk**: Medium - migration script handles data preservation
- **Downtime**: Minimal - can be done with brief maintenance window

## Rollback Plan
1. Restore database from backup
2. Revert code changes
3. Restart services

## Pre-Migration Checklist
- [ ] Database backup created
- [ ] Migration script tested on staging
- [ ] All team members notified
- [ ] Maintenance window scheduled
- [ ] Rollback plan prepared

## Post-Migration Checklist
- [ ] Verify all order operations work
- [ ] Test admin panel functionality
- [ ] Test vendor panel functionality
- [ ] Monitor error logs
- [ ] Update documentation
