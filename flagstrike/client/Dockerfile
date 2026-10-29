FROM node:20-alpine AS build
WORKDIR /usr/src/app

COPY client/package.json ./
RUN npm install
COPY client/ ./
COPY shared/ ../shared/
RUN npm test && npm run build

FROM nginx:alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /usr/src/app/dist/ /usr/share/nginx/html/

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
