# ==========================================
# STAGE 1: Build React Dashboard Frontend
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# ==========================================
# STAGE 2: FastAPI Backend Runtime
# ==========================================
FROM python:3.11-slim
WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy Backend application code
COPY backend/ /app/backend/
WORKDIR /app/backend

# Copy compiled frontend dist from Stage 1 into dashboard_dist
COPY --from=frontend-builder /app/dashboard/dist /app/backend/dashboard_dist

# Environment variables
ENV PYTHONPATH="/app/backend"
ENV PORT=8000
EXPOSE 8000

# Run Uvicorn server
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
