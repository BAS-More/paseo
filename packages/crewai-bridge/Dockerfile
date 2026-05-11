# CrewAI Bridge — lightweight FastAPI service
# Usage:
#   docker build -t crewai-bridge packages/crewai-bridge
#   docker run -p 8000:8000 crewai-bridge

FROM python:3.12-slim AS production

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.lock requirements.lock
RUN pip install --no-cache-dir -r requirements.lock

COPY api.py __init__.py ./

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

ENTRYPOINT ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
