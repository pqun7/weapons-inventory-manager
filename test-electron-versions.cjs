console.log('process.versions:', process.versions)
console.log('process.arch:', process.arch)
console.log('process.platform:', process.platform)
console.log('process.versions.modules:', process.versions.modules)
console.log('process.versions.electron:', process.versions.electron)
console.log('process.versions.node:', process.versions.node)
console.log('process.release:', process.release)

const { app } = require("electron");

app.whenReady().then(() => {
    console.log(process.versions);
    app.quit();
});