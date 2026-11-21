/**
 * Script Name: clerk-server.js
 * Type: Node.js web server (no npm packages), runs as a systemd service on EC2
 * Location: S3 bucket umak-elec3-bcsad-g07-code > clerk/clerk-server.js, copied to /opt/clerk/ by user data
 * Env vars: API_URL, CLERK_KEY, CLERK_USER, CLERK_PASS, PORT (default 80)
 */
const http = require("node:http");

const { API_URL, CLERK_KEY, CLERK_USER, CLERK_PASS } = process.env;
const PORT = process.env.PORT || 80;

const PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clerk: Open Quotation Requests</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#222}
  .card{border:1px solid #ccc;border-radius:8px;padding:1rem;margin-bottom:1rem}
  table{border-collapse:collapse;width:100%} td,th{border-bottom:1px solid #ddd;padding:.35rem;text-align:left}
  input{padding:.35rem;width:7rem;border:1px solid #bbb;border-radius:6px}
  button{padding:.45rem .9rem;border:0;border-radius:6px;background:#1d4ed8;color:#fff;cursor:pointer}
  .muted{color:#666;font-size:.9rem}.err{color:#b91c1c}
</style></head><body>
<h1>Open quotation requests</h1>
<p class="muted">Oldest first. Enter the unit price of every item, then save.</p>
<p><button id="reload">Reload</button></p>
<div id="list"></div>
<script>
const list = document.getElementById("list");
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };

async function load() {
  list.replaceChildren(el("p", "Loading..."));
  const res = await fetch("/api/requests");
  if (!res.ok) return list.replaceChildren(el("p", "Could not load requests.", "err"));
  const { requests } = await res.json();
  if (!requests.length) return list.replaceChildren(el("p", "No open requests."));
  list.replaceChildren(...requests.map(card));
}

function card(r) {
  const c = el("div", undefined, "card");
  c.append(el("strong", r.requestId), el("p", r.contractorName + " | " + r.contact + " | received " + new Date(r.createdAt).toLocaleString(), "muted"));
  const t = el("table");
  t.innerHTML = "<tr><th>Item</th><th>Qty</th><th>Unit price (PHP)</th><th>Line total</th></tr>";
  const inputs = [], totals = [];
  const totalOut = el("strong", "Total: 0.00");
  r.items.forEach((it, i) => {
    const tr = el("tr");
    const price = el("input"); price.type = "number"; price.min = "0"; price.step = "0.01";
    const line = el("span", "0.00");
    price.oninput = () => {
      totals[i] = (Number(price.value) || 0) * it.qty;
      line.textContent = totals[i].toFixed(2);
      totalOut.textContent = "Total: " + totals.reduce((a, b) => a + b, 0).toFixed(2);
    };
    totals[i] = 0; inputs.push(price);
    const tdPrice = el("td"); tdPrice.append(price);
    const tdLine = el("td"); tdLine.append(line);
    tr.append(el("td", it.name), el("td", it.qty + " " + it.unit), tdPrice, tdLine);
    t.append(tr);
  });
  const msg = el("span", "", "muted");
  const save = el("button", "Save quotation");
  save.onclick = async () => {
    const prices = inputs.map(i => Number(i.value));
    if (inputs.some(i => i.value === "")) { msg.textContent = " Enter every price."; msg.className = "err"; return; }
    const res = await fetch("/api/requests/" + encodeURIComponent(r.requestId) + "/quotation", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prices })
    });
    if (res.ok) { c.remove(); } else { msg.textContent = " Save failed."; msg.className = "err"; }
  };
  c.append(t, el("p"), totalOut, el("p"), save, msg);
  return c;
}
document.getElementById("reload").onclick = load;
load();
</script></body></html>`;

function authorized(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const [u, ...rest] = Buffer.from(h.slice(6), "base64").toString().split(":");
  return u === CLERK_USER && rest.join(":") === CLERK_PASS;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

http
  .createServer(async (req, res) => {
    if (!authorized(req)) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Clerk"' });
      return res.end("Login required");
    }
    try {
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(PAGE);
      }
      const isList = req.method === "GET" && req.url === "/api/requests";
      const isSave =
        req.method === "PUT" && /^\/api\/requests\/[A-Za-z0-9]+\/quotation$/.test(req.url);
      if (isList || isSave) {
        const upstream = await fetch(API_URL + req.url.slice(4), {
          method: req.method,
          headers: { "Content-Type": "application/json", "x-clerk-key": CLERK_KEY },
          body: isSave ? await readBody(req) : undefined,
        });
        res.writeHead(upstream.status, { "Content-Type": "application/json" });
        return res.end(await upstream.text());
      }
      res.writeHead(404);
      res.end("Not found");
    } catch (e) {
      console.error(e);
      res.writeHead(502);
      res.end("Upstream error");
    }
  })
  .listen(PORT, () => console.log("Clerk server on port " + PORT));