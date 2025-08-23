FROM nginx:alpine
WORKDIR /usr/src/app
COPY . /usr/src/app
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
EXPOSE 443
CMD ["nginx", "-g", "daemon off;"]