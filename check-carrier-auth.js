require('dotenv').config();

console.log('🔍 Checking Carrier API Authentication Configuration...\n');

// Check environment variables
console.log('Environment Variables:');
console.log('  - SHIPWAY_API_BASE_URL:', process.env.SHIPWAY_API_BASE_URL || 'NOT SET');
console.log('  - SHIPWAY_BASIC_AUTH_HEADER:', process.env.SHIPWAY_BASIC_AUTH_HEADER ? 'SET (hidden for security)' : 'NOT SET');

if (!process.env.SHIPWAY_BASIC_AUTH_HEADER) {
  console.log('\n❌ SHIPWAY_BASIC_AUTH_HEADER is not set!');
  console.log('Please add this to your .env file:');
  console.log('SHIPWAY_BASIC_AUTH_HEADER=Basic your-base64-encoded-credentials');
  console.log('\nTo create the Basic Auth header:');
  console.log('1. Take your Shipway username and password');
  console.log('2. Format as: username:password');
  console.log('3. Encode in base64');
  console.log('4. Add "Basic " prefix');
  console.log('\nExample:');
  console.log('echo -n "your-username:your-password" | base64');
  console.log('SHIPWAY_BASIC_AUTH_HEADER=Basic eW91ci11c2VybmFtZTp5b3VyLXBhc3N3b3Jk');
} else {
  console.log('\n✅ SHIPWAY_BASIC_AUTH_HEADER is configured');
  console.log('You can now run the carrier sync');
}

console.log('\n📝 Note: Make sure your .env file is in the backend directory'); 