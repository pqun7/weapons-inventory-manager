const Database = require("better-sqlite3");

console.log("Loading...");

const db = new Database(":memory:");

console.log("Opened");

db.close();

console.log("Closed");