type OAuthBeginCookieSnapshot = {
  shop: string;
  setCookies: string[];
  capturedAt: number;
};

const OAUTH_BEGIN_COOKIE_TTL_MS = 10 * 60 * 1000;
const snapshots = new Map<string, OAuthBeginCookieSnapshot>();

function normalizeShopKey(shop: string): string {
  return shop.trim().toLowerCase();
}

export function rememberOAuthBeginCookies(
  shop: string,
  setCookies: string[],
): void {
  if (!shop || setCookies.length === 0) return;

  snapshots.set(normalizeShopKey(shop), {
    shop,
    setCookies,
    capturedAt: Date.now(),
  });
}

export function getOAuthBeginCookieSnapshot(
  shop: string | null,
): OAuthBeginCookieSnapshot | null {
  if (!shop) return null;

  const snapshot = snapshots.get(normalizeShopKey(shop));
  if (!snapshot) return null;

  if (Date.now() - snapshot.capturedAt > OAUTH_BEGIN_COOKIE_TTL_MS) {
    snapshots.delete(normalizeShopKey(shop));
    return null;
  }

  return snapshot;
}

export function clearOAuthBeginCookieSnapshot(shop: string): void {
  snapshots.delete(normalizeShopKey(shop));
}
