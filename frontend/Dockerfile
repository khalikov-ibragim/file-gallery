FROM  docker.io/nginx:alpine

WORKDIR /usr/share/nginx/html

COPY  nginx.conf /etc/nginx/conf.d/default.cof

ENV BACKEND_HOST=backend

COPY . /usr/share/nginx/html