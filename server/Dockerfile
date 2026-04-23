# ─────────────────────────────────────────────────────────────────────
# NetPulse Server — Python Services
# Used for: API server, Kafka consumer, ML analyser
# ─────────────────────────────────────────────────────────────────────

FROM python:3.11-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all server code
COPY . .

# Create models directory for ML artifacts
RUN mkdir -p /app/models

# Default command (overridden in docker-compose per service)
CMD ["python", "-m", "uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
