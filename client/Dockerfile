FROM node:16-alpine
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm install -g http-server msgpack-lite
COPY . .
EXPOSE 8080
CMD ["http-server", ".", "-p", "8080"]