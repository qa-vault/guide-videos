// Loads the tool configuration: guides.config.json (tracked defaults) with
// guides.config.local.json (git-ignored, product-specific) merged over it.
// Objects merge key by key (theme, voice, timing); everything else is replaced.
// GUIDES_CONFIG (a JSON object in the environment) is merged last, for one-off runs.
// Not guaranteed: key order of the result, identity of untouched nested objects, a key named __proto__.
//
//   node config.mjs        prints the effective configuration
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const LOCAL_CONFIG = "guides.config.local.json";

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
export function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) out[k] = isObject(v) && isObject(base[k]) ? merge(base[k], v) : v;
  return out;
}

export function loadConfig() {
  const read = (f) => JSON.parse(readFileSync(path.join(here, f), "utf8"));
  const local = path.join(here, LOCAL_CONFIG);
  let cfg = existsSync(local) ? merge(read("guides.config.json"), read(LOCAL_CONFIG)) : read("guides.config.json");
  if (process.env.GUIDES_CONFIG) cfg = merge(cfg, JSON.parse(process.env.GUIDES_CONFIG));
  return cfg;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(loadConfig(), null, 2));
