# Build and run the Sirenic MCP server (stdio). Used by MCP catalogues that build servers from source (Glama):
# the server starts and lists its tools without any variable; pass SIRENIC_API_KEY or SIRENIC_WALLET_KEY to pay.
FROM node:22.17.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci --ignore-scripts
COPY src ./src
COPY catalogue ./catalogue
RUN npm run build && npm prune --omit=dev

FROM node:22.17.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/catalogue ./catalogue
USER node
ENTRYPOINT ["node", "dist/cli.js"]
