const mysql = require('mysql2/promise');
require('dotenv').config();

async function runMigration() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    console.log('🚀 Starting carriers table unique constraint migration...');
    console.log('📝 Changing UNIQUE constraint from carrier_id to (carrier_id, account_code)...\n');

    // Step 1: Drop the existing UNIQUE constraint on carrier_id
    console.log('Step 1: Dropping existing UNIQUE constraint on carrier_id...');
    try {
      // Get the constraint name
      const [constraints] = await connection.execute(`
        SELECT CONSTRAINT_NAME 
        FROM information_schema.TABLE_CONSTRAINTS 
        WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'carriers' 
        AND CONSTRAINT_TYPE = 'UNIQUE'
        AND CONSTRAINT_NAME != 'PRIMARY'
      `, [process.env.DB_NAME]);

      if (constraints.length > 0) {
        for (const constraint of constraints) {
          // Check if this constraint is on carrier_id
          const [keyColumns] = await connection.execute(`
            SELECT COLUMN_NAME 
            FROM information_schema.KEY_COLUMN_USAGE 
            WHERE TABLE_SCHEMA = ? 
            AND TABLE_NAME = 'carriers' 
            AND CONSTRAINT_NAME = ?
          `, [process.env.DB_NAME, constraint.CONSTRAINT_NAME]);

          const columnNames = keyColumns.map(k => k.COLUMN_NAME);
          if (columnNames.includes('carrier_id') && columnNames.length === 1) {
            console.log(`  Dropping constraint: ${constraint.CONSTRAINT_NAME}`);
            await connection.execute(`ALTER TABLE carriers DROP INDEX ${constraint.CONSTRAINT_NAME}`);
            console.log('  ✅ Constraint dropped\n');
          }
        }
      } else {
        console.log('  ⚠️ No UNIQUE constraint found on carrier_id\n');
      }
    } catch (error) {
      if (error.message.includes("doesn't exist") || error.message.includes("Unknown key")) {
        console.log('  ⚠️ Constraint may not exist, continuing...\n');
      } else {
        throw error;
      }
    }

    // Step 2: Add composite UNIQUE constraint on (carrier_id, account_code)
    console.log('Step 2: Adding composite UNIQUE constraint on (carrier_id, account_code)...');
    try {
      await connection.execute(`
        ALTER TABLE carriers 
        ADD UNIQUE KEY unique_carrier_store (carrier_id, account_code)
      `);
      console.log('  ✅ Composite UNIQUE constraint added\n');
    } catch (error) {
      if (error.message.includes("Duplicate key name")) {
        console.log('  ⚠️ Composite constraint already exists\n');
      } else {
        throw error;
      }
    }

    // Step 3: Verify the constraint
    console.log('Step 3: Verifying constraint...');
    const [newConstraints] = await connection.execute(`
      SELECT CONSTRAINT_NAME, COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'carriers' 
      AND CONSTRAINT_NAME = 'unique_carrier_store'
      ORDER BY ORDINAL_POSITION
    `, [process.env.DB_NAME]);

    if (newConstraints.length === 2) {
      const columns = newConstraints.map(c => c.COLUMN_NAME).sort();
      if (columns[0] === 'account_code' && columns[1] === 'carrier_id') {
        console.log('  ✅ Composite UNIQUE constraint verified: (account_code, carrier_id)');
      } else {
        console.log('  ✅ Composite UNIQUE constraint verified:', columns.join(', '));
      }
    } else {
      console.log('  ⚠️ Could not verify constraint');
    }

    console.log('\n🎉 Migration completed successfully!');
    console.log('📊 Carriers can now have the same carrier_id for different stores');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

runMigration();

