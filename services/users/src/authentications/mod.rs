mod create;

use axum::{routing::post, Router};

use crate::AppState;

pub(crate) fn router() -> Router<AppState> {
    Router::new().route("/authentications", post(create::authenticate))
}
