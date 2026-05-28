const BOUNCE_REQUEST_HEADER = "X-Shopify-Bounce";
const RETRY_INVALID_SESSION_HEADER = "X-Shopify-Retry-Invalid-Session-Request";

export type SessionTokenSource = "url_id_token" | "missing";

export type BootstrapDecision =
  | "skip_existing_session"
  | "bootstrap_from_url_id_token"
  | "skip_bounce_request"
  | "skip_missing_id_token";

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

export type BootstrapRequestContext = {
  urlIdToken: string | null;
  hasAuthorizationHeader: boolean;
  isBounceRequest: boolean;
  decision: BootstrapDecision;
  token: string | null;
  shape: SessionTokenShape;
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

export function extractUrlIdToken(request: Request): string | null {
  return normalizeSessionToken(
    new URL(request.url).searchParams.get("id_token"),
  );
}

export function hasAuthorizationHeader(request: Request): boolean {
  return Boolean(request.headers.get("authorization")?.match(/^Bearer\s+/i));
}

export function isBounceRequest(request: Request): boolean {
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  return (
    searchParams.has("session") ||
    url.pathname.includes("/auth/session-token") ||
    request.headers.get(RETRY_INVALID_SESSION_HEADER) === "1" ||
    request.headers.has(BOUNCE_REQUEST_HEADER)
  );
}

export function resolveBootstrapRequestContext(
  request: Request,
  hasExistingOfflineSession: boolean,
): BootstrapRequestContext {
  const urlIdToken = extractUrlIdToken(request);
  const authorizationHeader = hasAuthorizationHeader(request);
  const bounceRequest = isBounceRequest(request);
  const shape = describeSessionTokenShape(urlIdToken);

  if (hasExistingOfflineSession) {
    return {
      urlIdToken,
      hasAuthorizationHeader: authorizationHeader,
      isBounceRequest: bounceRequest,
      decision: "skip_existing_session",
      token: null,
      shape,
    };
  }

  if (bounceRequest && !urlIdToken) {
    return {
      urlIdToken,
      hasAuthorizationHeader: authorizationHeader,
      isBounceRequest: bounceRequest,
      decision: "skip_bounce_request",
      token: null,
      shape,
    };
  }

  if (!urlIdToken || !isValidSessionTokenShape(urlIdToken)) {
    return {
      urlIdToken,
      hasAuthorizationHeader: authorizationHeader,
      isBounceRequest: bounceRequest,
      decision: "skip_missing_id_token",
      token: null,
      shape,
    };
  }

  return {
    urlIdToken,
    hasAuthorizationHeader: authorizationHeader,
    isBounceRequest: bounceRequest,
    decision: "bootstrap_from_url_id_token",
    token: urlIdToken,
    shape,
  };
}
