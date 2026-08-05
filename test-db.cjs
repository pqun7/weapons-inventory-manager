const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

app.whenReady().then(() => {
    console.log("Electron started");

    const userData = app.getPath("userData");
    const dbDir = path.join(userData, "db");
    const dbPath = path.join(dbDir, "armory_store.db");

    console.log("userData =", userData);
    console.log("dbDir =", dbDir);
    console.log("dbPath =", dbPath);

    console.log("dbDir exists =", fs.existsSync(dbDir));

    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        console.log("dbDir created");
    }

    try {
        console.log("Loading better-sqlite3...");
        const db = new Database(dbPath);

        console.log("Database opened successfully");

        db.prepare("CREATE TABLE IF NOT EXISTS test(id INTEGER)").run();

        console.log("Query executed");

        db.close();

        console.log("Database closed");
    } catch (err) {
        console.error(err);
    }

    app.quit();
});