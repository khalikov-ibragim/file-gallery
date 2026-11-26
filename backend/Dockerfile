FROM docker.io/node:20-alpine

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

RUN addgroup -S appgroup && adduser -S appuser -G appgroup -u 10001 \
 && chown -R appuser:appgroup /app


CMD ["npm","start" ]