const BOUNCE_REQUEST_HEADER = "X-Shopify-Bounce";

export type SessionTokenSource =
  | "authorization_header"
  | "url_id_token"
  | "missing";

export type SessionTokenShape = {
  dotCount: number;
  length: number;
  startsWithBearer: boolean;
  hasThreeJwtSections: boolean;
};

export function describeSessionTokenShape(
  token: string | null | undefined,
): SessionTokenShape {
  const value = token?.trim() ?? "";
  const dotCount = value ? value.split(".").length - 1 : 0;
  return {
    dotCount,
    length: value.length,
    startsWithBearer: /^Bearer\s+/i.test(value),
    hasThreeJwtSections: dotCount === 3,
  };
}

export function isValidSessionTokenShape(token: string | null | undefined): boolean {
  const value = token?.trim();
  if (!value) return false;
  if (/^Bearer\s+/i.test(value)) return false;
  if (value.length < 20) return false;
  return value.split(".").length === 3;
}

export function extractBearerSessionToken(request: Request): string | null {
  const header = request.headers.get("authorization")?.trim();
  if (!header || !/^Bearer\s+/i.test(header)) {
    return null;
  }

  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || /^Bearer\s+/i.test(token)) {
    return null;
  }

  return token;
}

export function extractUrlIdToken(request: Request): string | null {
  const token = new URL(request.url).searchParams.get("id_token")?.trim();
  return token || null;
}

export function isSessionTokenBounceRequest(request: Request): boolean {
  return request.headers.has(BOUNCE_REQUEST_HEADER);
}

export function isEmbeddedIframeLoadRequest(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.searchParams.get("embedded") === "1" &&
    Boolean(url.searchParams.get("shop")) &&
    Boolean(url.searchParams.get("host"))
  );
}

export function shouldAttemptTokenExchangeBootstrap(request: Request): boolean {
  if (!isEmbeddedIframeLoadRequest(request) && !isSessionTokenBounceRequest(request)) {
    return false;
  }

  return Boolean(extractUrlIdToken(request) || extractBearerSessionToken(request));
}

export function resolveSessionTokenForExchange(request: Request): {
  token: string | null;
  source: SessionTokenSource;
  shape: SessionTokenShape;
} {
  const urlToken = extractUrlIdToken(request);
  if (urlToken) {
    const shape = describeSessionTokenShape(urlToken);
    if (isValidSessionTokenShape(urlToken)) {
      return { token: urlToken, source: "url_id_token", shape };
    }
    return { token: null, source: "url_id_token", shape };
  }

  const bearer = extractBearerSessionToken(request);
  if (bearer) {
    const shape = describeSessionTokenShape(bearer);
    if (isValidSessionTokenShape(bearer)) {
      return { token: bearer, source: "authorization_header", shape };
    }
    return { token: null, source: "authorization_header", shape };
  }

  return {
    token: null,
    source: "missing",
    shape: describeSessionTokenShape(null),
  };
}
