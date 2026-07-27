mod create;

use axum::{routing::post, Router};

use crate::AppState;

pub(crate) fn router() -> Router<AppState> {
    Router::new().route("/users", post(create::create_user))
}

pub(crate) use create::lookup_user_by_nickname;
