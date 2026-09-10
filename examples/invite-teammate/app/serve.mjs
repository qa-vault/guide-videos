// Serves the mock app for the example guide on http://localhost:3000 (any path → index.html).
//   node examples/invite-teammate/app/serve.mjs          PORT=0 picks a free port; the URL is printed.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const html = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "index.html"));
const port = Number(process.env.PORT ?? 3000);
const server = createServer((_, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html); });
server.listen(port, () => console.log(`mock app on http://localhost:${server.address().port}/settings/members`));
