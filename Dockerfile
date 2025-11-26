FROM apify/actor-node-playwright:18
COPY package*.json ./
RUN npm install --include=dev
COPY . ./
CMD [ "npm", "start" ]
