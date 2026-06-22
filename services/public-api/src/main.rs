use axum::{
    routing::{get, post},
    Router,
    extract::Path,
    http::StatusCode,
};

#[tokio::main]
async fn main() {
    let app = Router::new()
    .route("/", get(home))
    .route("/chats/{chat_id}/messages", post(send_message));

    let bind_addr = std::env::var("PUBLIC_API_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let listener = tokio::net::TcpListener::bind(&bind_addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn home() -> &'static str {
    "Hello, World!"
}

async fn send_message(Path(chat_id): Path<u32>) -> StatusCode {
    //println!("Sending message to chat: {}", chat_id);
    println!("Sending message to chat: {}", chat_id);
    StatusCode::CREATED
}