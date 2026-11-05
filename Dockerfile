FROM node:22-alpine
RUN apk add --no-cache python3 make g++
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter web build
ENV NODE_ENV=development
ENV PORT=3000
ENV WEB_DIST=/app/apps/web/dist
EXPOSE 3000
CMD ["pnpm", "--filter", "api", "start"]
