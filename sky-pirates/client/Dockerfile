FROM nginx:alpine
WORKDIR /usr/src/app

# Install Node.js for build script
RUN apk add --no-cache nodejs npm

# Copy all files
COPY . /usr/src/app

# Auto-generate cache-busting versions based on file modification times
RUN node build-version.js

# Configure nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
EXPOSE 443
CMD ["nginx", "-g", "daemon off;"]