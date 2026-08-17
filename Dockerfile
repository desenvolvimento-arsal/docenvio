FROM node:20-alpine
WORKDIR /app

# Dependências (cache eficiente)
COPY package*.json ./
RUN npm ci --omit=dev

# Código da aplicação
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
