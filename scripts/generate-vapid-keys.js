/**
 * Generate VAPID Keys for Push Notifications
 * Run this script to generate valid VAPID keys for your application
 */

const webpush = require('web-push');

console.log('🔑 Generating VAPID keys for push notifications...\n');

try {
  // Generate VAPID keys
  const vapidKeys = webpush.generateVAPIDKeys();

  console.log('✅ VAPID Keys generated successfully!\n');
  
  console.log('📋 Add these to your .env file:');
  console.log('=' .repeat(50));
  console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
  console.log('=' .repeat(50));
  
  console.log('\n📝 Copy the above lines to your .env file');
  console.log('🚀 Restart your backend server after adding the keys');
  
  console.log('\n🔍 Key Details:');
  console.log(`Public Key: ${vapidKeys.publicKey}`);
  console.log(`Private Key: ${vapidKeys.privateKey}`);
  
} catch (error) {
  console.error('❌ Error generating VAPID keys:', error.message);
  console.log('\n💡 Make sure you have the web-push package installed:');
  console.log('npm install web-push');
}
