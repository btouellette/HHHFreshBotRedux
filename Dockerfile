# Dockerfile

FROM node:12-alpine
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY crontab/root /var/spool/cron/crontabs/root
RUN chmod 0600 /var/spool/cron/crontabs/root

COPY . ./
