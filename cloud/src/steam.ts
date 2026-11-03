// Öffentliche Steam-Store-Endpunkte (kein API-Key), als Proxy für den Browser (CORS).
const UA = "BinaryBrotherhood/2.0";

export interface SteamResult { appId: number; name: string; imageUrl: string; price: string | null }
export interface SteamDetails { appId: number; name: string; description: string; imageUrl: string; steamUrl: string }

export async function steamSearch(term: string): Promise<SteamResult[]> {
  if (!term.trim()) return [];
  const res = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=german&cc=AT`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Steam antwortet mit ${res.status}`);
  const root = (await res.json()) as { items?: any[] };
  return (root.items ?? []).flatMap(o => {
    const id = Number(o.id), name = o.name as string;
    if (!id || !name) return [];
    let price: string | null = null;
    if (o.price && typeof o.price.final === "number") {
      const c = o.price.final as number, cur = (o.price.currency as string) || "EUR";
      price = `${Math.floor(c / 100)},${String(c % 100).padStart(2, "0")} ${cur}`;
    }
    return [{ appId: id, name, imageUrl: (o.tiny_image as string) || "", price }];
  });
}

export async function steamDetails(appId: number): Promise<SteamDetails | null> {
  const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=german&cc=AT`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Steam antwortet mit ${res.status}`);
  const root = (await res.json()) as Record<string, { success: boolean; data?: any }>;
  const entry = root[String(appId)];
  if (!entry?.success || !entry.data?.name) return null;
  const d = entry.data;
  const desc = String(d.short_description ?? "").replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim();
  return { appId, name: d.name, description: desc, imageUrl: d.header_image ?? "", steamUrl: `https://store.steampowered.com/app/${appId}/` };
}

export const steamAppIdFromUrl = (url: string): number | null => { const m = /\/app\/(\d+)/.exec(url); return m ? Number(m[1]) : null; };
