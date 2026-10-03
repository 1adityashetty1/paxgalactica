# Pax Galactica on Cloud Run (or any container host).
#
# The server is stateless — every request carries the campaign from the
# browser — so this image needs no volume and any number of instances can serve
# one player. See docs/cloud-run.md.

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY web ./web
RUN pnpm build && pnpm build:web && pnpm prune --prod

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    # Listen beyond loopback, on the port Cloud Run hands us ($PORT).
    PAXGALACTICA_HOST=0.0.0.0 \
    # The container's disk is RAM: write no save files. Saves live in the
    # player's browser and on their own disk.
    PAXGALACTICA_STORE=memory
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Read from disk at call time by src/model/prompts.ts.
COPY prompts ./prompts
USER node
CMD ["node", "dist/server/index.js"]
