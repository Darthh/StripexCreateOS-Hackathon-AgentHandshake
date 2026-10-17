# CreateOS Deploy: the Two-Key Worker running in workerd (the Cloudflare runtime) via wrangler dev.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && mkdir -p /data
EXPOSE 8080
CMD ["node", "scripts/serve.ts"]
