const { app, BrowserWindow } = require("electron");

app.whenReady().then(() => {
  console.log("Electron started");

  const win = new BrowserWindow({
    width: 800,
    height: 600,
  });

  win.loadURL("data:text/html,<h1>Hello Electron</h1>");

  console.log("Window created");
});