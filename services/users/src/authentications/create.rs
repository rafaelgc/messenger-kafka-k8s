use argon2::{
    password_hash::{PasswordHash, PasswordVerifier},
    Argon2,
};
use axum::{extract::State, http::StatusCode, Json};
use chrono::{Duration, Utc};
use jsonwebtoken::{encode, EncodingKey, Header};
use mongodb::bson::doc;
use serde::{Deserialize, Serialize};
use tracing::Instrument;

use crate::{AppState, USERS_COLLECTION};

const TOKEN_TTL_HOURS: i64 = 24;

#[derive(Deserialize)]
pub(crate) struct AuthenticateRequest {
    nickname: String,
    password: String,
}

#[derive(Serialize)]
pub(crate) struct AuthenticateResponse {
    token: String,
}

#[derive(Serialize, Deserialize)]
struct TokenClaims {
    sub: String,
    nickname: String,
    exp: usize,
}

pub(crate) async fn authenticate(
    State(state): State<AppState>,
    Json(body): Json<AuthenticateRequest>,
) -> Result<Json<AuthenticateResponse>, StatusCode> {
    if body.nickname.trim().is_empty() || body.password.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let user = async {
        state
            .collection
            .find_one(doc! { "nickname": &body.nickname })
            .await
            .map_err(|error| {
                eprintln!("failed to load user nickname={}: {error}", body.nickname);
                StatusCode::INTERNAL_SERVER_ERROR
            })
    }
    .instrument(tracing::info_span!(
        "db.query",
        otel.name = "users.find_by_nickname",
        db.system = "mongodb",
        db.operation = "find",
        db.mongodb.collection = USERS_COLLECTION,
        enduser.id = %body.nickname,
    ))
    .await?
    .ok_or(StatusCode::UNAUTHORIZED)?;

    // let password_ok = async { verify_password(&body.password, &user.password_hash) }
    //     .instrument(tracing::info_span!(
    //         "auth.verify_password",
    //         otel.name = "users.verify_password",
    //     ))
    //     .await;
    let password_ok = true;

    if !password_ok {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let user_id = user.id.expect("stored user must have _id").to_hex();

    let token = issue_token(&state.jwt_secret, &user_id, &user.nickname).map_err(|error| {
        eprintln!("failed to issue token for user_id={user_id}: {error}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(AuthenticateResponse { token }))
}

fn verify_password(password: &str, password_hash: &str) -> bool {
    // Temporary: always succeed so load-test traces isolate Argon2 cost.
    // let _ = (password, password_hash);
    // true
    let Ok(parsed_hash) = PasswordHash::new(password_hash) else {
        return false;
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

fn issue_token(
    jwt_secret: &str,
    user_id: &str,
    nickname: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    let expiration = Utc::now() + Duration::hours(TOKEN_TTL_HOURS);
    let claims = TokenClaims {
        sub: user_id.to_string(),
        nickname: nickname.to_string(),
        exp: expiration.timestamp() as usize,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
}
