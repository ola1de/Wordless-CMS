/**
 * Social sharing (Milestone 8) — plain share links, no API calls.
 *
 * Share links are just URLs (X, Facebook, WhatsApp, Telegram) that
 * open the provider's share sheet with the page URL + title. There is
 * no share counting, no API key, and no fake "12 shares" anywhere —
 * share counts are not measured by Wordless at all.
 */
export interface ShareLinks {
  x: string;
  facebook: string;
  whatsapp: string;
  telegram: string;
}

export function shareLinks(pageUrl: string, title: string): ShareLinks {
  const url = encodeURIComponent(pageUrl);
  const text = encodeURIComponent(title);
  return {
    x: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
    whatsapp: `https://wa.me/?text=${text}%20${url}`,
    telegram: `https://t.me/share/url?url=${url}&text=${text}`,
  };
}
