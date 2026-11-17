FROM  docker.io/nginx:alpine

WORKDIR /usr/share/nginx/html

COPY  nginx.conf /etc/nginx/conf.d/default.conf

ENV BACKEND_HOST=file-gallery-backend

COPY . /usr/share/nginx/html