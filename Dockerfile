# CreateOS Deploy: the Agent Handshake Worker running in workerd (the Cloudflare runtime) via wrangler dev.
FROM node:22-bookworm-slim
# workerd verifies TLS against the OS trust store (Node ships its own, so it masks this).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npx wrangler deploy --dry-run --outdir build && mkdir -p /data
EXPOSE 8080
CMD ["node", "scripts/serve.ts"]
