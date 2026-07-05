# syntax=docker/dockerfile:1
#
# CDK CLI toolchain image — run CDK without installing it on the host.
#
# Build:
#   docker build -t cdk-cli -f infra/Dockerfile infra
#
# Examples:
#   docker run --rm cdk-cli --version
#   docker run --rm -v "$PWD/infra/cdk:/workspace" -w /workspace cdk-cli synth
#   docker run --rm -it -v "$PWD/infra/cdk:/workspace" -w /workspace --entrypoint sh cdk-cli
#
# Mount ~/.aws (or pass AWS_* env vars) when deploying to AWS.

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim

ARG CDK_VERSION=2.1000.2
ARG AWS_CLI_VERSION=2.27.25

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    unzip \
  && arch="$(uname -m)" \
  && case "${arch}" in \
    x86_64) aws_arch="x86_64" ;; \
    aarch64) aws_arch="aarch64" ;; \
    *) echo "Unsupported architecture: ${arch}" >&2; exit 1 ;; \
  esac \
  && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${aws_arch}-${AWS_CLI_VERSION}.zip" -o /tmp/awscliv2.zip \
  && unzip -q /tmp/awscliv2.zip -d /tmp \
  && /tmp/aws/install \
  && rm -rf /tmp/aws /tmp/awscliv2.zip \
  && npm install -g "aws-cdk@${CDK_VERSION}" \
  && apt-get purge -y curl unzip \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

ENTRYPOINT ["cdk"]
CMD ["--version"]
