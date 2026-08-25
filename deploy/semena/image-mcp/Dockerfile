FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

HEALTHCHECK --interval=30s --timeout=10s --retries=5 \
  CMD curl -sf http://localhost:3003/health || exit 1

EXPOSE 3003
CMD ["python", "server.py"]
