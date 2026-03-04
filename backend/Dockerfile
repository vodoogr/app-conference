FROM node:20-alpine

WORKDIR /app

# Copiar archivos de dependencias
COPY package.json package-lock.json ./

# Instalar dependencias de producción
RUN npm ci --only=production

# Copiar código fuente
COPY app.js ./
COPY lib/ ./lib/

# Puerto configurable (Cloud Run usa PORT env var)
ENV PORT=8080
EXPOSE 8080

# Cloud Run envía señal SIGTERM para apagar el contenedor
CMD ["node", "app.js"]
