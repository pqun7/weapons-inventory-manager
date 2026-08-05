const { app } = require('electron');
console.log('electron process versions', process.versions);
try {
  const Database = require('better-sqlite3');
  console.log('better-sqlite3 loaded', typeof Database);
  const db = new Database(':memory:');
  console.log('db opened');
  db.close();
  console.log('db closed');
} catch (err) {
  console.error('better-sqlite3 failed', err);
}
app.whenReady().then(() => {
  console.log('app ready');
  setTimeout(() => app.quit(), 1000);
});
