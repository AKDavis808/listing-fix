export function extractSetCookieHeaders(headers: Headers): string[] {
  if (typeof headers.getSetCookie === "function") {
    const cookies = headers.getSetCookie();
    if (cookies.length > 0) {
      return cookies;
    }
  }

  const combined = headers.get("set-cookie");
  if (!combined) {
    return [];
  }

  return splitCombinedSetCookieHeader(combined);
}

function splitCombinedSetCookieHeader(combined: string): string[] {
  const cookies: string[] = [];
  let start = 0;

  for (let index = 0; index < combined.length; index += 1) {
    const slice = combined.slice(index);
    const match = slice.match(/^, [^=]+=/);
    if (!match) continue;

    cookies.push(combined.slice(start, index).trim());
    start = index + 2;
    index = start - 1;
  }

  const tail = combined.slice(start).trim();
  if (tail) {
    cookies.push(tail);
  }

  return cookies.length > 0 ? cookies : [combined];
}

export function appendSetCookieHeaders(
  target: Headers,
  cookies: string[],
): void {
  for (const cookie of cookies) {
    target.append("set-cookie", cookie);
  }
}

export function countSetCookieHeaders(headers: Headers): number {
  return extractSetCookieHeaders(headers).length;
}

export function copySetCookieHeaders(
  source: Headers,
  target: Headers,
  explicitCookies?: string[],
): void {
  appendSetCookieHeaders(target, explicitCookies ?? extractSetCookieHeaders(source));
}

export function mergeHeadersPreservingSetCookie(
  sources: Array<Headers | undefined>,
): Headers {
  const merged = new Headers();

  for (const source of sources) {
    if (!source) continue;

    appendSetCookieHeaders(merged, extractSetCookieHeaders(source));

    source.forEach((value, key) => {
      merged.append(key, value);
    });
  }

  return merged;
}
