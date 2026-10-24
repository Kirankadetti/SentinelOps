import logging
import os
import subprocess
import threading
import time
from datetime import datetime, timezone

from flask import Flask, jsonify, request

app = Flask(__name__)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sentinelops-recovery")

RECOVERY_TOKEN = os.environ.get("RECOVERY_TOKEN", "")
PLAYBOOK = "/app/playbooks/recover-nginx.yml"
RECOVERY_COOLDOWN = 60

events = []
last_recovery = 0.0
recovery_lock = threading.Lock()


def record_event(event):
    events.append(event)
    del events[:-100]


@app.get("/health")
def health():
    return jsonify({
        "service": "sentinelops-recovery-controller",
        "status": "healthy",
    }), 200


@app.get("/api/events")
def get_events():
    return jsonify({"events": events[-50:]}), 200


@app.post("/alerts")
def alerts():
    global last_recovery

    if RECOVERY_TOKEN:
        supplied = request.headers.get("Authorization", "")
        if supplied != f"Bearer {RECOVERY_TOKEN}":
            return jsonify({"error": "unauthorized"}), 401

    payload = request.get_json(silent=True) or {}
    accepted = 0

    for alert in payload.get("alerts", []):
        if alert.get("status") != "firing":
            continue

        labels = alert.get("labels", {})

        # Allow only the predefined NGINX recovery action.
        if labels.get("alertname") != "NginxServiceDown":
            continue

        event = {
            "alert": "NginxServiceDown",
            "service": "sentinelops-target",
            "received_at": datetime.now(timezone.utc).isoformat(),
            "action": "started",
        }

        with recovery_lock:
            now = time.monotonic()

            if now - last_recovery < RECOVERY_COOLDOWN:
                event["action"] = "skipped_cooldown"
                record_event(event)
                accepted += 1
                continue

            last_recovery = now

            try:
                result = subprocess.run(
                    [
                        "ansible-playbook",
                        "-i",
                        "localhost,",
                        "-c",
                        "local",
                        PLAYBOOK,
                    ],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    check=False,
                )

                event["return_code"] = result.returncode
                event["action"] = (
                    "recovered" if result.returncode == 0 else "failed"
                )
                event["output"] = result.stdout[-4000:]
                event["error"] = result.stderr[-2000:]

                if result.returncode == 0:
                    logger.info("NGINX recovery playbook completed successfully")
                else:
                    logger.error("NGINX recovery playbook failed: %s", result.stderr)

            except subprocess.TimeoutExpired:
                event["action"] = "timeout"
                event["error"] = "Ansible recovery exceeded 120 seconds"
                logger.error("NGINX recovery timed out")

            except Exception:
                logger.exception("Unexpected recovery execution error")
                event["action"] = "failed"
                event["error"] = "Unexpected recovery execution error"

            record_event(event)
            accepted += 1

    return jsonify({
        "accepted": accepted,
        "message": "Alert processed by the recovery controller",
    }), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002)