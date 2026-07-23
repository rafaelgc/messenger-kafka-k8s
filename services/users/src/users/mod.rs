mod create;
mod get;

use axum::{routing::get, Router};

use crate::AppState;

pub(crate) fn router() -> Router<AppState> {
    Router::new().route("/users", get(get::get_user).post(create::create_user))
}
