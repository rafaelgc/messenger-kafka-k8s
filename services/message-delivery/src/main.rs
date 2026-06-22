#[tokio::main]
async fn main() {
    println!("Hello from message-delivery");

    tokio::signal::ctrl_c()
        .await
        .expect("failed to listen for shutdown signal");
}