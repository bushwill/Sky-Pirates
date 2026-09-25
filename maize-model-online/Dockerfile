FROM nginx:alpine
WORKDIR /usr/src/app

RUN apk add --no-cache python3 bash
COPY client /usr/src/app
COPY build-version.js /usr/src/app/build-version.js
COPY build-version.txt /usr/src/app/build-version.txt
COPY start.sh /usr/src/app/start.sh
COPY nginx.conf /etc/nginx/nginx.conf

RUN chmod +x /usr/src/app/start.sh

EXPOSE 80
CMD ["/bin/sh", "/usr/src/app/start.sh"]