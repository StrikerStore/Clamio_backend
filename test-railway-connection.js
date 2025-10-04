require('dotenv').config();
const mysql = require('mysql2/promise');

async function testRailwayConnection() {
  console.log('🔍 Testing Railway Database Connection...');
  
  const dbConfig = {
    host: process.env.DB_HOST || 'caboose.proxy.rlwy.net',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'AHVfrOOILYWyQcWlToiTQvRCAnkBnCja',
    database: process.env.DB_NAME || 'railway',
    port: process.env.DB_PORT || 12197,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    connectTimeout: 60000,
    acquireTimeout: 60000,
    timeout: 60000
  };

  console.log('📋 Connection Config:', {
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    database: dbConfig.database,
    ssl: !!dbConfig.ssl
  });

  try {
    console.log('🔄 Attempting to connect...');
    const connection = await mysql.createConnection(dbConfig);
    console.log('✅ Successfully connected to Railway database!');
    
    // Test a simple query
    const [rows] = await connection.execute('SELECT 1 as test');
    console.log('✅ Query test successful:', rows);
    
    // Check if tables exist
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('📊 Available tables:', tables.map(t => Object.values(t)[0]));
    
    await connection.end();
    console.log('✅ Connection closed successfully');
    
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.error('🔍 Error details:', {
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage
    });
    
    // Common error solutions
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Solution: Check if Railway database is running and accessible');
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('\n💡 Solution: Check username and password');
    } else if (error.code === 'ENOTFOUND') {
      console.log('\n💡 Solution: Check hostname and port');
    } else if (error.code === 'ETIMEDOUT') {
      console.log('\n💡 Solution: Check network connectivity and firewall settings');
    }
  }
}

testRailwayConnection();