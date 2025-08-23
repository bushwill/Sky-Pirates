FROM nginx:alpine
WORKDIR /usr/src/app
COPY . /usr/src/app
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 8081
EXPOSE 4443
CMD ["nginx", "-g", "daemon off;"]