use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

use crate::{telemetry, AppState};

#[derive(Deserialize, Serialize)]
pub(crate) struct CreateUserRequest {
    nickname: String,
    password: String,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct CreateUserResponse {
    id: String,
    nickname: String,
}

#[derive(Deserialize)]
pub(crate) struct GetUserResponse {
    pub(crate) id: String,
    pub(crate) nickname: String,
}

pub(crate) async fn create_user(
    State(state): State<AppState>,
    Json(body): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<CreateUserResponse>), StatusCode> {
    let url = format!("{}/users", state.users_service_url.trim_end_matches('/'));

    let response = telemetry::traced_execute(
        &state.http_client,
        state.http_client.post(&url).json(&body),
        "users.create",
        "users",
    )
    .await
    .map_err(|error| {
        eprintln!("failed to call users service to create user: {error}");
        StatusCode::BAD_GATEWAY
    })?;

    let status = response.status();
    if !status.is_success() {
        return Err(upstream_status(status));
    }

    let user = response.json::<CreateUserResponse>().await.map_err(|error| {
        eprintln!("failed to decode users service create response: {error}");
        StatusCode::BAD_GATEWAY
    })?;

    Ok((StatusCode::CREATED, Json(user)))
}

pub(crate) async fn lookup_user_by_nickname(
    state: &AppState,
    nickname: &str,
) -> Result<GetUserResponse, StatusCode> {
    let url = format!("{}/users", state.users_service_url.trim_end_matches('/'));

    let response = telemetry::traced_execute(
        &state.http_client,
        state
            .http_client
            .get(&url)
            .query(&[("nickname", nickname)]),
        "users.lookup",
        "users",
    )
    .await
    .map_err(|error| {
        eprintln!("failed to call users service for nickname={nickname}: {error}");
        StatusCode::BAD_GATEWAY
    })?;

    if response.status() == reqwest::StatusCode::BAD_REQUEST {
        return Err(StatusCode::BAD_REQUEST);
    }

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(StatusCode::NOT_FOUND);
    }

    if !response.status().is_success() {
        eprintln!(
            "users service returned {} for nickname={nickname}",
            response.status()
        );
        return Err(StatusCode::BAD_GATEWAY);
    }

    response.json::<GetUserResponse>().await.map_err(|error| {
        eprintln!("failed to decode users service lookup for nickname={nickname}: {error}");
        StatusCode::BAD_GATEWAY
    })
}

fn upstream_status(status: reqwest::StatusCode) -> StatusCode {
    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY)
}
