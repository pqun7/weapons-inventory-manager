try {
  const Database = require("better-sqlite3");
  console.log("better-sqlite3 loaded successfully");
  console.log(process.versions);
} catch (e) {
  console.error(e);
}