FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm install -g serve
CMD sed -i "s|__GEMINI_API_KEY__|$GEMINI_API_KEY|g" dist/index.html && serve -s dist -l tcp://0.0.0.0:$PORT
