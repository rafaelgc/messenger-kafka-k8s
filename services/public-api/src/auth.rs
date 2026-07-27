use axum::http::{header::AUTHORIZATION, HeaderMap, StatusCode};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::Deserialize;

#[derive(Deserialize)]
#[allow(dead_code)]
pub(crate) struct TokenClaims {
    pub(crate) sub: String,
    pub(crate) nickname: String,
    pub(crate) exp: usize,
}

pub(crate) fn authenticate_request(
    headers: &HeaderMap,
    jwt_secret: &str,
) -> Result<String, StatusCode> {
    Ok(authenticate_user(headers, jwt_secret)?.sub)
}

pub(crate) fn authenticate_user(
    headers: &HeaderMap,
    jwt_secret: &str,
) -> Result<TokenClaims, StatusCode> {
    let token = bearer_token(headers)?;
    decode_token(jwt_secret, token)
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, StatusCode> {
    let value = headers
        .get(AUTHORIZATION)
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let value = value.to_str().map_err(|_| StatusCode::UNAUTHORIZED)?;

    value
        .strip_prefix("Bearer ")
        .ok_or(StatusCode::UNAUTHORIZED)
}

fn decode_token(jwt_secret: &str, token: &str) -> Result<TokenClaims, StatusCode> {
    decode::<TokenClaims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)
    .map_err(|error| {
        eprintln!("invalid auth token: {error}");
        StatusCode::UNAUTHORIZED
    })
}
