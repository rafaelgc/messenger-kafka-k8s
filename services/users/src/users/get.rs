use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use mongodb::bson::doc;
use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Deserialize)]
pub(crate) struct GetUserQuery {
    nickname: String,
}

#[derive(Serialize)]
pub(crate) struct GetUserResponse {
    id: String,
    nickname: String,
}

pub(crate) async fn get_user(
    State(state): State<AppState>,
    Query(query): Query<GetUserQuery>,
) -> Result<Json<GetUserResponse>, StatusCode> {
    if query.nickname.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let user = state
        .collection
        .find_one(doc! { "nickname": &query.nickname })
        .await
        .map_err(|error| {
            eprintln!("failed to load user nickname={}: {error}", query.nickname);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or(StatusCode::NOT_FOUND)?;

    let id = user
        .id
        .expect("stored user must have _id")
        .to_hex();

    Ok(Json(GetUserResponse {
        id,
        nickname: user.nickname,
    }))
}
