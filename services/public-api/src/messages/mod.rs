mod list;
mod send;

use axum::{routing::get, Router};

use crate::AppState;

pub(crate) fn router() -> Router<AppState> {
    Router::new().route(
        "/chats/{chat_id}/messages",
        get(list::list_messages).post(send::send_message),
    )
}
