const BASE = 'https://anineko.to';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function stripTags(html: string) {
  return html.replace(/<[^>]*>?/gm, '').trim();
}

function decodeEntities(str: string) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export async function fetchAniNekoStreams(title: string, episode: number, audio: 'sub' | 'dub' = 'sub') {
  try {
    const searchUrl = `${BASE}/browser?keyword=${encodeURIComponent(title)}`;
    const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!searchRes.ok) return [];
    const searchHtml = await searchRes.text();

    const results: { slug: string; text: string }[] = [];
    for (const m of searchHtml.matchAll(/<a\b[^>]*class=["'][^"']*nv-anime-thumb[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)) {
      const tag = m[0].match(/<a\b[^>]*>/i)?.[0] ?? "";
      const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
      if (!hrefMatch) continue;
      const slugMatch = hrefMatch[1].match(/\/watch\/([^/?#]+)/);
      if (!slugMatch) continue;
      const slug = slugMatch[1];
      const titleMatch = m[0].match(/<(?:h3|[^>]+class=["'][^"']*nv-anime-title[^"']*["'][^>]*)>([\s\S]*?)<\/(?:h3|[^>]+)>/i);
      results.push({ slug, text: titleMatch ? stripTags(titleMatch[1]) : slug.replace(/-/g, " ") });
    }

    if (results.length === 0) return [];

    const expected = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let bestSlug = results[0].slug;
    let bestScore = -999;

    for (const r of results) {
      let score = 0;
      const t = r.text.toLowerCase();
      if (r.slug === expected) score += 1000;
      if (t === title.toLowerCase()) score += 1000;
      if (t.includes(title.toLowerCase())) score += 500;
      if (score > bestScore) {
        bestScore = score;
        bestSlug = r.slug;
      }
    }

    const epSlug = `ep-${episode}`;
    const watchUrl = `${BASE}/watch/${bestSlug}/${epSlug}`;
    const watchRes = await fetch(watchUrl, { headers: { 'User-Agent': USER_AGENT, 'Referer': `${BASE}/watch/${bestSlug}` } });
    if (!watchRes.ok) return [];
    const watchHtml = await watchRes.text();

    const byAudio: { sub: string[]; dub: string[] } = { sub: [], dub: [] };
    for (const panel of watchHtml.matchAll(/<div\b[^>]*class=["'][^"']*nv-server-grid[^"']*["'][^>]*data-id=["']([^"']+)["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*nv-server-grid|$)/gi)) {
      const rawAudio = panel[1].toLowerCase();
      const panelAudio = rawAudio.includes("dub") ? "dub" : "sub";
      for (const btn of panel[2].matchAll(/data-video=["']([^"']+)["']/gi)) {
        byAudio[panelAudio].push(decodeEntities(btn[1]));
      }
    }

    const embeds = byAudio[audio] || byAudio['sub'] || [];
    const streams = [];

    for (let i = 0; i < embeds.length; i++) {
      const embed = embeds[i];
      try {
        const embedRes = await fetch(embed, { headers: { 'User-Agent': USER_AGENT, 'Referer': `${BASE}/` } });
        if (!embedRes.ok) continue;
        const embedHtml = await embedRes.text();
        const patterns = [
          /const\s+src\s*=\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
          /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
          /["'](https?:\/\/[^"']+\/master\.m3u8[^"']*)["']/i,
          /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
        ];
        for (const pattern of patterns) {
          const m = embedHtml.match(pattern);
          if (m) {
            const hlsUrl = decodeEntities(m[1]);
            streams.push({
              provider: 'anineko',
              server: `AniNeko ${i + 1}`,
              url: hlsUrl,
              directUrl: hlsUrl,
              quality: 'Auto',
              audio,
              isHls: true,
              referer: `${new URL(embed).origin}/`
            });
            break;
          }
        }
      } catch {
        // continue
      }
    }

    return streams;
  } catch (err) {
    return [];
  }
}
