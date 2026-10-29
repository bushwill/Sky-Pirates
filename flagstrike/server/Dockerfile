FROM node:20-alpine
WORKDIR /usr/src/app

COPY server/package.json ./
RUN npm install --omit=dev
COPY server/ ./
COPY shared/ ../shared/
RUN npm test

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
