use std::time::Duration;

use axum::http::{Request, Response};
use opentelemetry::global;
use opentelemetry::propagation::Injector;
use opentelemetry::trace::TracerProvider;
use opentelemetry_sdk::{
    propagation::TraceContextPropagator,
    trace::{Sampler, SdkTracerProvider},
};
use tower_http::{
    classify::SharedClassifier,
    trace::{
        DefaultOnBodyChunk, DefaultOnEos, DefaultOnFailure, DefaultOnRequest, TraceLayer,
    },
};
use tracing::Span;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub struct TelemetryGuard {
    provider: SdkTracerProvider,
}

impl TelemetryGuard {
    pub fn init() -> Self {
        global::set_text_map_propagator(TraceContextPropagator::new());

        let service_name =
            std::env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| "public-api".into());

        let exporter = opentelemetry_otlp::SpanExporter::builder()
            .with_tonic()
            .build()
            .expect("failed to build OTLP span exporter");

        let sampler_ratio = std::env::var("OTEL_TRACES_SAMPLER_ARG")
            .ok()
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(1.0);

        let provider = SdkTracerProvider::builder()
            .with_batch_exporter(exporter)
            .with_sampler(Sampler::ParentBased(Box::new(Sampler::TraceIdRatioBased(
                sampler_ratio,
            ))))
            .with_resource(
                opentelemetry_sdk::Resource::builder_empty()
                    .with_attribute(opentelemetry::KeyValue::new(
                        "service.name",
                        service_name.clone(),
                    ))
                    .build(),
            )
            .build();

        let tracer = provider.tracer(service_name);

        tracing_subscriber::registry()
            .with(
                EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| EnvFilter::new("info")),
            )
            .with(tracing_opentelemetry::layer().with_tracer(tracer))
            .init();

        Self { provider }
    }

    pub fn shutdown(self) {
        if let Err(error) = self.provider.shutdown() {
            eprintln!("failed to shutdown tracer provider: {error}");
        }
    }
}

struct ReqwestHeaderInjector<'a>(&'a mut reqwest::header::HeaderMap);

impl Injector for ReqwestHeaderInjector<'_> {
    fn set(&mut self, key: &str, value: String) {
        if let Ok(name) = reqwest::header::HeaderName::from_bytes(key.as_bytes()) {
            if let Ok(val) = reqwest::header::HeaderValue::from_str(&value) {
                self.0.insert(name, val);
            }
        }
    }
}

pub fn with_trace_context(
    builder: reqwest::RequestBuilder,
) -> Result<reqwest::Request, reqwest::Error> {
    let mut request = builder.build()?;
    let cx =
        tracing_opentelemetry::OpenTelemetrySpanExt::context(&tracing::Span::current());

    global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&cx, &mut ReqwestHeaderInjector(request.headers_mut()));
    });

    Ok(request)
}

#[derive(Clone, Copy, Default)]
pub struct HttpMakeSpan;

impl<B> tower_http::trace::MakeSpan<B> for HttpMakeSpan {
    fn make_span(&mut self, request: &Request<B>) -> Span {
        let method = request.method().as_str();
        let path = request.uri().path();
        tracing::info_span!(
            "request",
            otel.name = %format_args!("{method} {path}"),
            method = %method,
            http.target = %path,
            http.status_code = tracing::field::Empty,
        )
    }
}

#[derive(Clone, Copy, Default)]
pub struct HttpRecordStatus;

impl<B> tower_http::trace::OnResponse<B> for HttpRecordStatus {
    fn on_response(self, response: &Response<B>, _latency: Duration, span: &Span) {
        span.record("http.status_code", response.status().as_u16());
    }
}

pub type HttpTraceLayer = TraceLayer<
    SharedClassifier<tower_http::classify::ServerErrorsAsFailures>,
    HttpMakeSpan,
    DefaultOnRequest,
    HttpRecordStatus,
    DefaultOnBodyChunk,
    DefaultOnEos,
    DefaultOnFailure,
>;

pub fn http_trace_layer() -> HttpTraceLayer {
    TraceLayer::new_for_http()
        .make_span_with(HttpMakeSpan)
        .on_response(HttpRecordStatus)
}

pub async fn traced_execute(
    client: &reqwest::Client,
    builder: reqwest::RequestBuilder,
    span_name: &'static str,
    peer: &'static str,
) -> Result<reqwest::Response, reqwest::Error> {
    use tracing::Instrument;

    let request = with_trace_context(builder)?;

    async move { client.execute(request).await }.instrument(tracing::info_span!(
        "http.client",
        otel.name = span_name,
        peer.service = peer,
    ))
    .await
}
