use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

use crate::{telemetry, AppState};

#[derive(Deserialize, Serialize)]
pub(crate) struct AuthenticateRequest {
    nickname: String,
    password: String,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct AuthenticateResponse {
    token: String,
}

pub(crate) async fn authenticate(
    State(state): State<AppState>,
    Json(body): Json<AuthenticateRequest>,
) -> Result<Json<AuthenticateResponse>, StatusCode> {
    let url = format!(
        "{}/authentications",
        state.users_service_url.trim_end_matches('/')
    );

    let response = telemetry::traced_execute(
        &state.http_client,
        state.http_client.post(&url).json(&body),
        "users.authenticate",
        "users",
    )
    .await
    .map_err(|error| {
        eprintln!("failed to call users service to authenticate: {error}");
        StatusCode::BAD_GATEWAY
    })?;

    let status = response.status();
    if !status.is_success() {
        return Err(upstream_status(status));
    }

    response
        .json::<AuthenticateResponse>()
        .await
        .map_err(|error| {
            eprintln!("failed to decode users service authentication response: {error}");
            StatusCode::BAD_GATEWAY
        })
        .map(Json)
}

fn upstream_status(status: reqwest::StatusCode) -> StatusCode {
    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY)
}
