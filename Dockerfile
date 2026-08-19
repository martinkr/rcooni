# rcooni — minimal write-capable issue tracker (MCP + audit view).
# Published to the same registry as Kamori (GitHub Container Registry):
#   docker build -t ghcr.io/martinkr/rcooni:latest .
#   docker push  ghcr.io/martinkr/rcooni:latest
# The book's docker-compose.yml then pulls it exactly like Kamori's image.

# --- build stage: compile TypeScript to dist/ ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# --- runtime stage: production deps + compiled output only ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# 3120 = human audit view + /healthz, 3121 = MCP endpoint. Issues persist under /app/data.
EXPOSE 3120 3121
VOLUME ["/app/data"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -qO- http://localhost:3120/healthz || exit 1

CMD ["node", "dist/server.js"]
