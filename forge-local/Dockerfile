FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

ENV CI=1 \
    NODE_ENV=test \
    ATLAS_FORGE_PARITY=1 \
    ATLAS_FORGE_INVOCATION_TIMEOUT_MS=25000 \
    ATLAS_FORGE_MEMORY_MB=512 \
    ATLAS_DATA_MODE=fixture

CMD ["bash", ".github/scripts/forge-parity-check.sh", "--inside"]
