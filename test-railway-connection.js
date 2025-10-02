const mysql = require('mysql2/promise');
require('dotenv').config();

async function testRailwayConnection() {
  console.log('🔍 Testing Railway Database Connection...\n');
  
  // Log environment variables (without passwords)
  console.log('Environment Variables:');
  console.log('- DB_HOST:', process.env.DB_HOST || 'Not set');
  console.log('- DB_USER:', process.env.DB_USER || 'Not set');
  console.log('- DB_NAME:', process.env.DB_NAME || 'Not set');
  console.log('- DB_PORT:', process.env.DB_PORT || 'Not set');
  console.log('- MYSQL_URL:', process.env.MYSQL_URL ? 'Set (hidden)' : 'Not set');
  console.log('- NODE_ENV:', process.env.NODE_ENV || 'Not set');
  console.log('');

  let dbConfig = {
    host: process.env.DB_HOST || process.env.MYSQL_HOST || process.env.MYSQLHOST,
    user: process.env.DB_USER || process.env.MYSQL_USER || process.env.MYSQLUSER,
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || process.env.MYSQLPASSWORD,
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE || process.env.MYSQLDATABASE,
    port: process.env.DB_PORT || process.env.MYSQL_PORT || process.env.MYSQLPORT || 3306
  };

  // Parse MYSQL_URL if provided
  if (process.env.MYSQL_URL) {
    try {
      const url = new URL(process.env.MYSQL_URL);
      dbConfig.host = url.hostname;
      dbConfig.port = url.port || 3306;
      dbConfig.user = url.username;
      dbConfig.password = url.password;
      dbConfig.database = url.pathname.substring(1);
      console.log('✅ Parsed MYSQL_URL');
    } catch (error) {
      console.error('❌ Error parsing MYSQL_URL:', error.message);
      return;
    }
  }

  console.log('Connection Config:');
  console.log('- Host:', dbConfig.host);
  console.log('- Port:', dbConfig.port);
  console.log('- User:', dbConfig.user);
  console.log('- Database:', dbConfig.database);
  console.log('- Has Password:', !!dbConfig.password);
  console.log('');

  // Test different connection configurations
  const connectionConfigs = [
    {
      name: 'Basic Connection',
      config: {
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        port: dbConfig.port,
        connectTimeout: 10000
      }
    },
    {
      name: 'With SSL (Railway)',
      config: {
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        port: dbConfig.port,
        ssl: { rejectUnauthorized: false },
        connectTimeout: 10000
      }
    },
    {
      name: 'With Database',
      config: {
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        port: dbConfig.port,
        ssl: { rejectUnauthorized: false },
        connectTimeout: 10000
      }
    }
  ];

  for (const { name, config } of connectionConfigs) {
    console.log(`🧪 Testing: ${name}`);
    try {
      const connection = await mysql.createConnection(config);
      console.log(`✅ ${name} - SUCCESS`);
      
      // Test a simple query
      const [rows] = await connection.execute('SELECT 1 as test');
      console.log(`✅ Query test - SUCCESS:`, rows[0]);
      
      await connection.end();
      console.log('');
    } catch (error) {
      console.log(`❌ ${name} - FAILED:`, error.message);
      console.log('');
    }
  }
}

testRailwayConnection().catch(console.error);
