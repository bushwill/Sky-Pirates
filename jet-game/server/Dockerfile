FROM node:16-alpine
WORKDIR /usr/src/app
COPY package.json ./
RUN npm install
RUN npm install express ws msgpack5
COPY . .
EXPOSE 3001
CMD ["node", "app.js"]
