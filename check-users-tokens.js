const database = require('./config/database');

async function checkUsersTokens() {
  try {
    await database.waitForMySQLInitialization();
    
    if (!database.isMySQLAvailable()) {
      console.log('❌ MySQL not available');
      return;
    }
    
    const users = await database.getAllUsers();
    console.log(`Total users: ${users.length}`);
    
    users.forEach((user, i) => {
      console.log(`${i+1}. ${user.name} - Token: ${user.token ? 'YES' : 'NO'} - Active: ${user.active_session}`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkUsersTokens();
