FROM python:3.11-slim
WORKDIR /app

# Install system essentials
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code and pre-compiled frontend assets
COPY backend/ /app/backend/
WORKDIR /app/backend

ENV PYTHONPATH="/app/backend"
ENV PORT=10000
EXPOSE 10000

# Start Uvicorn listening on Render's dynamic PORT
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
