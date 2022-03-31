FROM node:17
ENV PORT=8080
COPY . /kontroller
WORKDIR /kontroller
RUN npm install
ENTRYPOINT ["node", "kontroller.js"]
