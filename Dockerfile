FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY --from=builder /app/build/ build/

ENV TRANSPORT=http
ENV PORT=3000
ENV HEALTH_API_BASE_URL=http://backend:8000

EXPOSE 3000
CMD ["node", "build/index.js"]
