# Backend Dockerfile for MinusX BI
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv package manager
RUN pip install --no-cache-dir uv

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install Python dependencies using uv
RUN uv pip install --system -r pyproject.toml

# Copy application code
COPY . .

# Create data directory for database files
RUN mkdir -p /app/data

# Expose backend port
EXPOSE 8001

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Default to 4 workers if not specified
# Recommended: (2 x CPU cores) + 1
ENV WORKERS=4

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8001/health || exit 1

# Run the application with Gunicorn + Uvicorn workers
CMD gunicorn main:app \
    --workers ${WORKERS} \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8001 \
    --access-logfile - \
    --error-logfile - \
    --log-level info
