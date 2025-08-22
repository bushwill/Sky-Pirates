FROM nginx:alpine
WORKDIR /usr/src/app
COPY . /usr/src/app
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY selfsigned.crt /usr/src/app/selfsigned.crt
COPY selfsigned.key /usr/src/app/selfsigned.key
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]