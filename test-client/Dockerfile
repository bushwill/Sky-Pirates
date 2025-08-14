FROM node:16-alpine
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm install -g http-server
COPY . .
EXPOSE 8081
CMD ["http-server", ".", "-p", "8081"]