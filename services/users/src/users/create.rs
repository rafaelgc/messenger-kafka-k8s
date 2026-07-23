use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2,
};
use axum::{extract::State, http::StatusCode, Json};
use mongodb::error::{Error, ErrorKind, WriteError, WriteFailure};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};

use crate::{AppState, UserDocument};

#[derive(Deserialize)]
pub(crate) struct CreateUserRequest {
    nickname: String,
    password: String,
}

#[derive(Serialize)]
pub(crate) struct CreateUserResponse {
    id: String,
    nickname: String,
}

pub(crate) async fn create_user(
    State(state): State<AppState>,
    Json(body): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<CreateUserResponse>), StatusCode> {
    if body.nickname.trim().is_empty() || body.password.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let password_hash = hash_password(&body.password).map_err(|error| {
        eprintln!("failed to hash password: {error}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let user = UserDocument {
        id: None,
        nickname: body.nickname.clone(),
        password_hash,
    };

    let insert_result = state.collection.insert_one(&user).await.map_err(|error| {
        if is_duplicate_key_error(&error) {
            return StatusCode::CONFLICT;
        }

        eprintln!("failed to create user nickname={}: {error}", body.nickname);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let id = insert_result
        .inserted_id
        .as_object_id()
        .expect("inserted user id must be an ObjectId")
        .to_hex();

    Ok((
        StatusCode::CREATED,
        Json(CreateUserResponse {
            id,
            nickname: body.nickname,
        }),
    ))
}

fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default().hash_password(password.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

fn is_duplicate_key_error(error: &Error) -> bool {
    matches!(
        error.kind.as_ref(),
        ErrorKind::Write(WriteFailure::WriteError(WriteError { code: 11000, .. }))
    )
}
