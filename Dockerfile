FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* turbo.json tsconfig.base.json ./
COPY . .
RUN npm install
RUN npx turbo run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=8080
ENV PORT=8080
COPY --from=builder /app ./
EXPOSE 8080
CMD ["node", "apps/blackbox-api/dist/server.js"]
