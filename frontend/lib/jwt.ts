export type TokenClaims = {
  sub: string;
  nickname: string;
  exp: number;
};

export function decodeJwtPayload(token: string): TokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }

  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(payload);
  return JSON.parse(decoded) as TokenClaims;
}

export function isTokenExpired(claims: TokenClaims): boolean {
  return claims.exp * 1000 <= Date.now();
}
