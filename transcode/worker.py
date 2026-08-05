#!/usr/bin/env python3
"""KreatorKit transcode worker.

Polls the app for one proxy job at a time, encodes it with ffmpeg, and PUTs the
result straight to storage with the presigned URL the job carried. Deliberately
dumb and stateless:

  * no database access — the queue is the app's worker API
  * no bytes through the app — reads the master from a presigned URL, writes the
    proxy to a presigned URL (the 2026-07-13 OOM was caused by piping media
    through the Next app; nothing here repeats it)
  * one job at a time — encoding is CPU-bound, so a second lane on the same box
    just makes both slower. Run more replicas to go wider.

Any machine with ffmpeg can be a worker: this container on Railway, or a GPU box
at home (set FFMPEG_VIDEO_ARGS to an NVENC recipe and it will use it).

Env:
  KK_BASE_URL          https://... (the app)
  TRANSCODE_API_KEY    worker key, sent as X-Worker-Key
  KK_AGENT_KEY         optional fallback, sent as X-Agent-Key
  POLL_SECONDS         idle sleep between empty claims (default 30)
  FFMPEG_PRESET        x264 preset (default veryfast)
  FFMPEG_CRF           x264 quality (default 23)
  FFMPEG_VIDEO_ARGS    full override, e.g. "-c:v h264_nvenc -preset p4 -cq 26"
"""

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

BASE_URL = os.environ.get("KK_BASE_URL", "").rstrip("/")
WORKER_KEY = os.environ.get("TRANSCODE_API_KEY", "")
AGENT_KEY = os.environ.get("KK_AGENT_KEY", "")
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "30"))
FFMPEG_PRESET = os.environ.get("FFMPEG_PRESET", "veryfast")
FFMPEG_CRF = os.environ.get("FFMPEG_CRF", "23")
FFMPEG_VIDEO_ARGS = os.environ.get("FFMPEG_VIDEO_ARGS", "").strip()

# A single encode of a long 4K master can legitimately run for hours; past this
# we assume something is wedged and let the job go back on the queue.
FFMPEG_TIMEOUT_SECONDS = int(os.environ.get("FFMPEG_TIMEOUT_SECONDS", str(6 * 60 * 60)))


def log(message: str) -> None:
    print(f"[transcode] {message}", flush=True)


def api(method: str, path: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload or {}).encode()
    req = urllib.request.Request(f"{BASE_URL}{path}", data=body, method=method)
    req.add_header("Content-Type", "application/json")
    if WORKER_KEY:
        req.add_header("X-Worker-Key", WORKER_KEY)
    if AGENT_KEY:
        req.add_header("X-Agent-Key", AGENT_KEY)
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode() or "{}")


def probe_dimensions(url: str) -> tuple[int | None, int | None]:
    """Read the source geometry without downloading the file."""
    try:
        out = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "json",
                url,
            ],
            capture_output=True, text=True, timeout=300, check=True,
        ).stdout
        streams = json.loads(out).get("streams") or []
        if not streams:
            return None, None
        return streams[0].get("width"), streams[0].get("height")
    except Exception as exc:  # noqa: BLE001 - any probe failure is just "unknown"
        log(f"probe failed: {exc}")
        return None, None


def video_args() -> list[str]:
    if FFMPEG_VIDEO_ARGS:
        return FFMPEG_VIDEO_ARGS.split()
    return ["-c:v", "libx264", "-preset", FFMPEG_PRESET, "-crf", FFMPEG_CRF]


def encode(source_url: str, height: int, out_path: str) -> None:
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", source_url,
        # Even width/height: h264 needs both divisible by 2, and odd values from
        # an unusual aspect ratio are the classic "encode failed" cause.
        "-vf", f"scale=-2:{height}",
        *video_args(),
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        # faststart so the browser can start playing before the file is buffered.
        "-movflags", "+faststart",
        out_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True,
                   timeout=FFMPEG_TIMEOUT_SECONDS)


def upload(path: str, url: str) -> None:
    size = os.path.getsize(path)
    with open(path, "rb") as handle:
        req = urllib.request.Request(url, data=handle, method="PUT")
        req.add_header("Content-Type", "video/mp4")
        req.add_header("Content-Length", str(size))
        with urllib.request.urlopen(req, timeout=FFMPEG_TIMEOUT_SECONDS) as res:
            if res.status not in (200, 201):
                raise RuntimeError(f"upload returned {res.status}")


def run_job(job: dict) -> None:
    proxy_id = job["proxyId"]
    height = int(job["height"])
    label = f"{job.get('videoTitle', '?')} · {height}p"
    log(f"claimed {label}")

    width, source_height = probe_dimensions(job["sourceUrl"])
    if source_height and source_height < height:
        # Nothing to gain from upscaling — record it so the rung stops being retried.
        log(f"skipping {label}: source is {source_height}p")
        api("POST", f"/api/agent/transcode/{proxy_id}", {
            "result": "skipped",
            "sourceWidth": width,
            "sourceHeight": source_height,
        })
        return

    with tempfile.TemporaryDirectory() as workdir:
        out_path = os.path.join(workdir, f"{height}p.mp4")
        started = time.time()
        encode(job["sourceUrl"], height, out_path)
        upload(out_path, job["uploadUrl"])
        took = int(time.time() - started)
        size_mb = os.path.getsize(out_path) / (1024 * 1024)
        log(f"done {label} in {took}s ({size_mb:.0f}MB)")

    api("POST", f"/api/agent/transcode/{proxy_id}", {
        "result": "ready",
        "width": width,
        "sourceWidth": width,
        "sourceHeight": source_height,
    })


def report_failure(proxy_id: str, error: Exception) -> None:
    detail = str(error)
    if isinstance(error, subprocess.CalledProcessError) and error.stderr:
        detail = error.stderr.strip().splitlines()[-1] if error.stderr.strip() else detail
    log(f"failed {proxy_id}: {detail}")
    try:
        api("POST", f"/api/agent/transcode/{proxy_id}", {
            "result": "failed",
            "error": detail[:500],
        })
    except Exception as exc:  # noqa: BLE001
        log(f"could not report the failure: {exc}")


def main() -> int:
    if not BASE_URL or not (WORKER_KEY or AGENT_KEY):
        log("KK_BASE_URL and TRANSCODE_API_KEY (or KK_AGENT_KEY) are required")
        return 1

    log(f"worker up against {BASE_URL}")
    while True:
        job = None
        try:
            job = (api("POST", "/api/agent/transcode/claim").get("data") or {}).get("job")
        except urllib.error.HTTPError as exc:
            log(f"claim failed: HTTP {exc.code}")
        except Exception as exc:  # noqa: BLE001
            log(f"claim failed: {exc}")

        if not job:
            time.sleep(POLL_SECONDS)
            continue

        try:
            run_job(job)
        except Exception as exc:  # noqa: BLE001 - never let one bad cut kill the loop
            report_failure(job["proxyId"], exc)


if __name__ == "__main__":
    sys.exit(main())
