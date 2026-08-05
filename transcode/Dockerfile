# KreatorKit transcode worker: turns each uploaded cut into 4K/1080/720 proxies.
# ffmpeg-only image — this service never talks to Postgres, it drives the queue
# through the app's worker API and moves bytes straight to/from storage.
FROM python:3.12-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY worker.py .
ENTRYPOINT []
CMD ["python3", "worker.py"]
