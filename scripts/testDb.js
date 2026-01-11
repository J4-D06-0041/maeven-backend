const { testConnection } = require('../src/db');

(async () => {
  try {
    const now = await testConnection();
    console.log('DB connectivity test succeeded:', now);
    process.exit(0);
  } catch (err) {
    console.error('DB connectivity test failed:', err.message || err);
    process.exit(2);
  }
})();
