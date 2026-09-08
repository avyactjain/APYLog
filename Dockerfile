FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY config ./config
COPY public ./public
COPY sql ./sql

RUN npm run build

ENV APP_ENV=prod
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--disable-warning=DEP0040", "dist/index.js"]
