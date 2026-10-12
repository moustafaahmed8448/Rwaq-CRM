FROM node:22-alpine AS dependencies

WORKDIR /app
RUN apk add --no-cache openssl

# Prisma reads both datasource URLs even when generating the client. These
# build-only values are never used by the running container.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
    DATABASE_URL_UNPOOLED="postgresql://build:build@localhost:5432/build?schema=public"

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

FROM dependencies AS build

COPY . .
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME="0.0.0.0" \
    PORT=3000

RUN apk add --no-cache openssl

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts

USER node
EXPOSE 3000

CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0"]
