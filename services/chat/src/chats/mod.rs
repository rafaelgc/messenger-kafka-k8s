mod create;
mod get;
mod list;

use axum::{routing::get, Router};

use crate::AppState;

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/chats", get(list::list_chats).post(create::create_chat))
        .route("/chats/{id}", get(get::get_chat))
}
