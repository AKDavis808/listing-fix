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
  jwtSectionCount: number;
  tokenPrefix12: string;
  tokenTypeof: string;
  includesWhitespace: boolean;
};

export function normalizeSessionToken(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;

  let token = String(raw).trim();
  if (!token) return null;

  if (/^Bearer\s+/i.test(token)) {
    token = token.replace(/^Bearer\s+/i, "").trim();
  }

  return token || null;
}

export function describeSessionTokenShape(
  token: string | null | undefined,
): SessionTokenShape {
  const value = normalizeSessionToken(token) ?? "";
  const jwtSections = value ? value.split(".") : [];
  const dotCount = jwtSections.length > 0 ? jwtSections.length - 1 : 0;
  const hasThreeJwtSections = jwtSections.length === 3;

  return {
    dotCount,
    length: value.length,
    startsWithBearer: /^Bearer\s+/i.test(String(token ?? "").trim()),
    hasThreeJwtSections,
    jwtSectionCount: jwtSections.length,
    tokenPrefix12: value.slice(0, 12),
    tokenTypeof: typeof token,
    includesWhitespace: /\s/.test(value),
  };
}

export function isValidSessionTokenShape(token: string | null | undefined): boolean {
  const value = normalizeSessionToken(token);
  if (!value) return false;
  if (value.length < 20) return false;

  const jwtSections = value.split(".");
  return jwtSections.length === 3;
}

export function extractBearerSessionToken(request: Request): string | null {
  return normalizeSessionToken(request.headers.get("authorization"));
}

export function extractUrlIdToken(request: Request): string | null {
  return normalizeSessionToken(
    new URL(request.url).searchParams.get("id_token"),
  );
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
  if (urlToken !== null) {
    const shape = describeSessionTokenShape(urlToken);
    if (isValidSessionTokenShape(urlToken)) {
      return { token: urlToken, source: "url_id_token", shape };
    }
    return { token: null, source: "url_id_token", shape };
  }

  const bearer = extractBearerSessionToken(request);
  if (bearer !== null) {
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
