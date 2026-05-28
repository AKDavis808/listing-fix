const BOUNCE_REQUEST_HEADER = "X-Shopify-Bounce";
const RETRY_INVALID_SESSION_HEADER = "X-Shopify-Retry-Invalid-Session-Request";

export type SessionTokenSource =
  | "authorization_header"
  | "url_id_token"
  | "missing";

export type BootstrapDecision =
  | "skip_existing_session"
  | "bootstrap_from_authorization_header"
  | "skip_url_id_token"
  | "skip_missing_token";

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
  authorizationToken: string | null;
  hasAuthorizationHeader: boolean;
  isBounceRequest: boolean;
  decision: BootstrapDecision;
  token: string | null;
  tokenSource: SessionTokenSource;
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

export function extractBearerSessionToken(request: Request): string | null {
  return normalizeSessionToken(request.headers.get("authorization"));
}

export function extractUrlIdToken(request: Request): string | null {
  return normalizeSessionToken(
    new URL(request.url).searchParams.get("id_token"),
  );
}

export function hasAuthorizationHeader(request: Request): boolean {
  return extractBearerSessionToken(request) !== null;
}

export function isBounceRequest(request: Request): boolean {
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  if (url.pathname.includes("/auth/session-token")) {
    return true;
  }

  if (request.headers.get(RETRY_INVALID_SESSION_HEADER) === "1") {
    return true;
  }

  if (request.headers.has(BOUNCE_REQUEST_HEADER)) {
    return true;
  }

  return searchParams.has("session") && request.headers.has(BOUNCE_REQUEST_HEADER);
}

export function hasEmbeddedContext(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.searchParams.get("embedded") === "1" &&
    Boolean(url.searchParams.get("shop")) &&
    Boolean(url.searchParams.get("host"))
  );
}

export function resolveBootstrapRequestContext(
  request: Request,
  hasExistingOfflineSession: boolean,
): BootstrapRequestContext {
  const urlIdToken = extractUrlIdToken(request);
  const authorizationToken = extractBearerSessionToken(request);
  const bounceRequest = isBounceRequest(request);
  const baseContext = {
    urlIdToken,
    authorizationToken,
    hasAuthorizationHeader: authorizationToken !== null,
    isBounceRequest: bounceRequest,
  };

  if (hasExistingOfflineSession) {
    return {
      ...baseContext,
      decision: "skip_existing_session",
      token: null,
      tokenSource: "missing",
      shape: describeSessionTokenShape(authorizationToken ?? urlIdToken),
    };
  }

  if (authorizationToken && isValidSessionTokenShape(authorizationToken)) {
    return {
      ...baseContext,
      decision: "bootstrap_from_authorization_header",
      token: authorizationToken,
      tokenSource: "authorization_header",
      shape: describeSessionTokenShape(authorizationToken),
    };
  }

  if (urlIdToken) {
    return {
      ...baseContext,
      decision: "skip_url_id_token",
      token: null,
      tokenSource: "url_id_token",
      shape: describeSessionTokenShape(urlIdToken),
    };
  }

  return {
    ...baseContext,
    decision: "skip_missing_token",
    token: null,
    tokenSource: authorizationToken ? "authorization_header" : "missing",
    shape: describeSessionTokenShape(authorizationToken),
  };
}
