# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM node:22-slim AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app

# Install backend dependencies (production only)
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy backend source + tesseract language data
COPY backend/src ./backend/src
COPY backend/eng.traineddata ./backend/eng.traineddata

# Copy built frontend from stage 1
COPY --from=frontend /app/dist ./dist

# Uploads directory (mounted as volume at runtime)
RUN mkdir -p backend/uploads/pdfs backend/uploads/parts

EXPOSE 3001
CMD ["node", "backend/src/index.js"]
