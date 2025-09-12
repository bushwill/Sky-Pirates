FROM node:16-alpine
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm install
RUN npm install express mysql2 path cors ws msgpack5
COPY . .
EXPOSE 3000
CMD ["node", "App.mjs"]