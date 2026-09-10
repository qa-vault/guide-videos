// Saves a logged-in browser session for the recorder.
// Opens the product in a visible browser; log in by hand, then press Enter in the terminal.
//
//   node save-login.mjs [output-file]      default: the `storageState` path from the configuration
import { chromium } from "playwright";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";

const CONFIG = loadConfig();
const out = path.resolve(process.argv[2] ?? CONFIG.storageState ?? "storage-state.json");

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: CONFIG.viewport, colorScheme: CONFIG.colorScheme });
const page = await context.newPage();
try { await page.goto(CONFIG.baseUrl); }
catch (e) { console.error(`Cannot open ${CONFIG.baseUrl}: ${e.message.split("\n")[0]}\nStart the product first, or fix "baseUrl" in guides.config.local.json.`); await browser.close(); process.exit(2); }
console.log(`Log in at ${CONFIG.baseUrl} in the browser window, then press Enter here to save the session to\n  ${out}`);
await new Promise((r) => createInterface({ input: process.stdin }).once("line", r));
await context.storageState({ path: out });
await browser.close();
console.log(`Saved. Set "storageState": "${path.relative(process.cwd(), out)}" in guides.config.local.json if it is not already.`);
process.exit(0);
