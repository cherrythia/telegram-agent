FROM oven/bun:1-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY server.ts agent.ts ./
COPY lib ./lib
COPY tools ./tools
COPY providers ./providers

ENV NODE_ENV=production

CMD ["bun", "server.ts"]
