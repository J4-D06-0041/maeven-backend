const { createSchema } = require('../src/db/initSchema');
const { connectWithRetry, closePool } = require('../src/db');

(async () => {
  try {
    await connectWithRetry({ retries: 5, initialDelay: 1000 });
    await createSchema();
    console.log('Initialization finished');
    await closePool();
    process.exit(0);
  } catch (err) {
    console.error('Initialization failed:', err.message || err);
    try { await closePool(); } catch (e) {}
    process.exit(1);
  }
})();
