// Erzeugt src/changelog.json aus der Git-Historie (vor jedem Deploy). Admins sehen daraus die Neuerungen.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

let raw = "";
try { raw = execSync("git log -n 80 --format=%h%x1f%ct%x1f%s%x1f%b%x1e", { encoding: "utf8" }); } catch { raw = ""; }
const entries = raw.split("\x1e").map(s => s.trim()).filter(Boolean).map(rec => {
  const [hash, ts, subject, body = ""] = rec.split("\x1f");
  const lines = body.split("\n").map(l => l.trim())
    .filter(l => l && !/^Co-Authored-By:/i.test(l));
  // Aufzählungen übernehmen, Fließtext zu einem Absatz zusammenfassen
  const items = [];
  for (const l of lines) {
    if (/^[-*]\s+/.test(l)) items.push(l.replace(/^[-*]\s+/, ""));
    else if (items.length && /^\s/.test(l) === false && !/[.:]$/.test(items[items.length - 1])) items[items.length - 1] += " " + l;
    else items.push(l);
  }
  return { hash, ts: Number(ts) * 1000, subject, items };
});
writeFileSync(new URL("../src/changelog.json", import.meta.url), JSON.stringify(entries, null, 1));
console.log(`changelog.json: ${entries.length} Einträge`);
