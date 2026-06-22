#[tokio::main]
async fn main() {
    println!("Hello from message-push");

    tokio::signal::ctrl_c()
        .await
        .expect("failed to listen for shutdown signal");
}