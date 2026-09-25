FROM nginx:alpine
WORKDIR /usr/src/app
RUN apk add --no-cache nodejs
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["sh", "-c", "cp -a /usr/src/source/. /usr/src/app/ && node build-version.js && exec nginx -g 'daemon off;'"]
