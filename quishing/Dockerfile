# QR Sentinel : interface web + API d'analyse (Python, sans dépendance)
FROM python:3.12-slim

WORKDIR /app
COPY index.html ./
COPY css ./css
COPY js ./js
COPY data ./data
COPY vendor ./vendor
COPY backend/quishing ./backend/quishing

ENV PORT=8000 \
    TRUST_PROXY=1 \
    PYTHONUNBUFFERED=1
EXPOSE 8000
USER nobody
WORKDIR /app/backend
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:%s/api/health'%os.environ['PORT'])"
CMD ["python", "-m", "quishing.server"]
