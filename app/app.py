from datetime import datetime, timezone

import requests
from flask import Flask, Response, jsonify, render_template
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    generate_latest,
)

app = Flask(__name__)

PROMETHEUS_URL = "http://prometheus:9090"
ALERTMANAGER_URL = "http://alertmanager:9093"
RECOVERY_URL = "http://recovery-controller:5002"

HTTP_REQUESTS = Counter(
    "sentinelops_http_requests_total",
    "Total HTTP requests handled by SentinelOps",
    ["endpoint", "method", "status"],
)

APP_UP = Gauge(
    "sentinelops_application_up",
    "Whether the SentinelOps application is running",
)
APP_UP.set(1)


@app.after_request
def record_request(response):
    from flask import request

    endpoint = request.endpoint or "unknown"
    if endpoint != "metrics":
        HTTP_REQUESTS.labels(
            endpoint=endpoint,
            method=request.method,
            status=str(response.status_code),
        ).inc()

    return response


@app.get("/")
def dashboard():
    return render_template("index.html")


@app.get("/health")
def health():
    return jsonify({
        "status": "healthy",
        "service": "sentinelops-api",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }), 200


@app.get("/api/status")
def status():
    return jsonify({
        "platform": "SentinelOps",
        "status": "operational",
        "message": "Monitoring and recovery components are configured",
    }), 200


@app.get("/api/recovery-health")
def recovery_health():
    try:
        response = requests.get(
            f"{RECOVERY_URL}/health",
            timeout=3,
        )
        response.raise_for_status()
        return jsonify(response.json()), 200
    except requests.RequestException:
        return jsonify({
            "service": "sentinelops-recovery-controller",
            "status": "unavailable",
        }), 503


@app.get("/api/recovery-events")
def recovery_events():
    try:
        response = requests.get(
            f"{RECOVERY_URL}/api/events",
            timeout=5,
        )
        response.raise_for_status()
        return jsonify(response.json()), 200
    except requests.RequestException:
        return jsonify({
            "events": [],
            "error": "Recovery controller is unavailable",
        }), 503


@app.get("/metrics")
def metrics():
    return Response(
        generate_latest(),
        mimetype=CONTENT_TYPE_LATEST,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)