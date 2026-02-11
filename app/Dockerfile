FROM node:18-slim
WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --production
COPY . .
RUN mkdir -p /app/exports
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/index.js"]

