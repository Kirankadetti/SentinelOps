const API_BASE = "";
const PROMETHEUS_URL = "http://localhost:9090";
const ALERTMANAGER_URL = "http://localhost:9093";
const REFRESH_INTERVAL = 10000;

async function fetchJSON(url, timeout = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

function setBadge(id, isUp, upText = "Operational") {
    const element = document.getElementById(id);
    if (!element) return;

    element.textContent = isUp ? upText : "Unavailable";
    element.className = `badge ${isUp ? "up" : "down"}`;
}

function setStatus(id, dotId, isUp) {
    const element = document.getElementById(id);
    const dot = document.getElementById(dotId);

    if (element) {
        element.textContent = isUp ? "Online" : "Offline";
    }

    if (dot) {
        dot.style.background = isUp ? "var(--green)" : "var(--red)";
        dot.style.boxShadow = isUp
            ? "0 0 10px #4ce0a080"
            : "0 0 10px #ff718580";
    }
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

async function getPrometheusValue(query) {
    const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
    const data = await fetchJSON(url);

    if (data.status !== "success") {
        throw new Error("Prometheus query failed");
    }

    return data.data.result;
}

async function getProbeStatus() {
    try {
        const result = await getPrometheusValue(
            'probe_success{job="blackbox-nginx"}'
        );

        return result.length > 0 && Number(result[0].value[1]) === 1;
    } catch (error) {
        console.warn("Unable to read NGINX probe:", error.message);
        return null;
    }
}

async function getTargetUp() {
    try {
        const result = await getPrometheusValue(
            'up{job="sentinelops-api"}'
        );

        return result.length > 0 && Number(result[0].value[1]) === 1;
    } catch (error) {
        console.warn("Unable to read API scrape status:", error.message);
        return null;
    }
}

async function getPrometheusHealth() {
    try {
        const data = await fetchJSON(
            `${PROMETHEUS_URL}/-/healthy`
        );
        return Boolean(data);
    } catch {
        return false;
    }
}

async function getAlertmanagerHealth() {
    try {
        await fetchJSON(`${ALERTMANAGER_URL}/-/healthy`);
        return true;
    } catch {
        return false;
    }
}

async function getAlerts() {
    try {
        const data = await fetchJSON(
            `${ALERTMANAGER_URL}/api/v2/alerts`
        );

        return Array.isArray(data)
            ? data.filter(alert => alert.status?.state === "active")
            : [];
    } catch (error) {
        console.warn("Unable to read alerts:", error.message);
        return null;
    }
}


function renderAlerts(alerts) {
    const container = document.getElementById("alerts-list");
    const count = document.getElementById("alert-count");
    const state = document.getElementById("alert-state");

    if (!container || !count || !state) return;

    if (alerts === null) {
        container.innerHTML =
            '<div class="empty-state">Unable to connect to Alertmanager.</div>';
        count.textContent = "—";
        state.textContent = "OFFLINE";
        return;
    }

    count.textContent = alerts.length;
    state.textContent = alerts.length ? "FIRING" : "ALL CLEAR";

    if (!alerts.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div style="font-size:28px;color:var(--green);margin-bottom:8px">✓</div>
                No active alerts detected.<br>
                <span style="font-size:11px">Monitoring is continuing.</span>
            </div>`;
        return;
    }

    container.innerHTML = alerts.map((alert, index) => {
        const labels = alert.labels || {};
        const annotations = alert.annotations || {};
        const critical = labels.severity === "critical";
        const severity = labels.severity || "warning";
        const alertName = labels.alertname || "Unnamed alert";
        const description =
            annotations.description ||
            annotations.summary ||
            "No additional details available.";
        const service = labels.service || labels.job || "Not specified";
        const status = alert.status?.state || "firing";
        const startsAt = alert.startsAt
            ? new Date(alert.startsAt).toLocaleString()
            : "Not provided";
        const fingerprint = alert.fingerprint || `${alertName}-${index}`;
        const panelId = `alert-details-${index}`;

        return `
            <article class="alert-item alert-expandable">
                <button
                    type="button"
                    class="alert-trigger"
                    aria-expanded="false"
                    aria-controls="${panelId}"
                    data-alert-index="${index}"
                >
                    <span class="alert-indicator ${critical ? "" : "warning"}"></span>

                    <span class="alert-copy">
                        <strong>${escapeHTML(alertName)}</strong>
                        <small>${escapeHTML(description)}</small>
                    </span>

                    <span class="alert-status">
                        ${escapeHTML(severity.toUpperCase())}
                    </span>

                    <span class="alert-chevron" aria-hidden="true">⌄</span>
                </button>

                <div class="alert-details" id="${panelId}" hidden>
                    <p><strong>Severity:</strong> ${escapeHTML(severity)}</p>
                    <p><strong>Affected service:</strong> ${escapeHTML(service)}</p>
                    <p><strong>Status:</strong> ${escapeHTML(status)}</p>
                    <p><strong>Started:</strong> ${escapeHTML(startsAt)}</p>
                    <p><strong>Fingerprint:</strong> ${escapeHTML(fingerprint)}</p>
                    <p><strong>Description:</strong> ${escapeHTML(description)}</p>
                    <p class="muted">
                        Recovery is handled by the configured recovery controller
                        when the alert meets the recovery rules.
                    </p>
                </div>
            </article>`;
    }).join("");

    container.querySelectorAll(".alert-trigger").forEach(button => {
        button.addEventListener("click", () => {
            const details = document.getElementById(
                button.getAttribute("aria-controls")
            );
            if (!details) return;

            const isExpanded =
                button.getAttribute("aria-expanded") === "true";

            button.setAttribute("aria-expanded", String(!isExpanded));
            details.hidden = isExpanded;
        });
    });
}

async function getRecoveryEvents() {
    try {
        const data = await fetchJSON("/api/recovery-events");
        return Array.isArray(data.events) ? data.events : [];
    } catch (error) {
        console.warn("Unable to read recovery history:", error.message);
        return null;
    }
}

function formatTime(timestamp) {
    if (!timestamp) return "—";

    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "UTC"
    }) + " UTC";
}

function renderRecoveryEvents(events) {
    const table = document.getElementById("recovery-table");
    const count = document.getElementById("recovery-count");

    if (events === null) {
        table.innerHTML = `
            <tr><td colspan="4" class="empty-state">
                Recovery controller data unavailable.
            </td></tr>`;
        count.textContent = "—";
        return;
    }

    const successful = events.filter(event => event.action === "recovered");
    count.textContent = successful.length;

    if (!events.length) {
        table.innerHTML = `
            <tr><td colspan="4" class="empty-state">
                No recovery events recorded yet.
            </td></tr>`;
        return;
    }

    table.innerHTML = [...events].reverse().map(event => {
        const action = event.action || "unknown";
        const failed = ["failed", "timeout"].includes(action);
        const skipped = action === "skipped_cooldown";

        const pillClass = failed
            ? "failed"
            : skipped
                ? "skipped"
                : "";

        return `
            <tr>
                <td>${escapeHTML(event.alert || "Infrastructure event")}</td>
                <td>${escapeHTML(event.service || "—")}</td>
                <td><span class="result-pill ${pillClass}">
                    ${escapeHTML(action.replaceAll("_", " ").toUpperCase())}
                </span></td>
                <td>${escapeHTML(formatTime(event.received_at))}</td>
            </tr>`;
    }).join("");
}

async function refreshDashboard() {
    const connection = document.getElementById("connection-state");
    connection.textContent = "Refreshing monitoring data…";

    const [probe, api, prometheus, alertmanager, alerts, events] =
        await Promise.all([
            getProbeStatus(),
            getTargetUp(),
            getPrometheusHealth(),
            getAlertmanagerHealth(),
            getAlerts(),
            getRecoveryEvents()
        ]);

    setStatus("target-status", "target-dot", probe === true);
    document.getElementById("target-status").textContent =
        probe === null ? "Unknown" : probe ? "Online" : "Offline";

    setStatus("api-status", "api-dot", api === true);
    document.getElementById("api-status").textContent =
        api === null ? "Unknown" : api ? "Online" : "Offline";

    setBadge("nginx-badge", probe === true, probe === null ? "Unknown" : "Online");
    if (probe === false) setBadge("nginx-badge", false);
    if (probe === null) {
        document.getElementById("nginx-badge").textContent = "Unknown";
        document.getElementById("nginx-badge").className = "badge pending";
    }

    setBadge("prom-badge", prometheus);
    setBadge("am-badge", alertmanager);

    const recoveryBadge = document.getElementById("recovery-badge");
    try {
        await fetchJSON("/api/recovery-health");
        recoveryBadge.textContent = "Online";
        recoveryBadge.className = "badge up";
    } catch {
        recoveryBadge.textContent = "Unavailable";
        recoveryBadge.className = "badge down";
    }

    renderAlerts(alerts);
    renderRecoveryEvents(events);

    document.getElementById("last-updated").textContent =
        `Updated ${new Date().toLocaleTimeString()}`;

    const healthy =
        probe === true &&
        api === true &&
        prometheus &&
        alertmanager &&
        alerts !== null &&
        events !== null;

    connection.textContent = healthy
        ? "All monitoring connections available"
        : "One or more components need attention";
}

// Refresh button with visible loading feedback
const refreshButton = document.getElementById("refresh-btn");

refreshButton.addEventListener("click", async () => {
    if (refreshButton.disabled) return;

    refreshButton.disabled = true;
    refreshButton.textContent = "↻ Refreshing...";

    try {
        await refreshDashboard();
    } finally {
        refreshButton.disabled = false;
        refreshButton.textContent = "↻ Refresh";
    }
});

// Highlight sidebar navigation based on the visible section
const navigationLinks = document.querySelectorAll(".nav-item");
const sections = document.querySelectorAll(
    "#overview, #services, #alerts, #recovery"
);

function updateActiveNavigation() {
    const currentHash = window.location.hash;
    const target = currentHash
        ? document.querySelector(currentHash)
        : document.querySelector("#overview");

    navigationLinks.forEach(link => {
        link.classList.toggle(
            "active",
            link.hash === (target ? `#${target.id}` : "#overview")
        );
    });
}

navigationLinks.forEach(link => {
    link.addEventListener("click", () => {
        navigationLinks.forEach(item => item.classList.remove("active"));
        link.classList.add("active");
    });
});

window.addEventListener("hashchange", updateActiveNavigation);
updateActiveNavigation();

// Keep the dashboard data refreshed automatically
refreshDashboard();
setInterval(refreshDashboard, REFRESH_INTERVAL);


/* Interactive infrastructure service details */
const serviceDetails = {
    nginx: {
        title: "NGINX Target",
        description: "Monitored web service",
        endpoint: "Endpoint: http://localhost:8081",
        role: "Serves the target web page. Blackbox Exporter probes its availability, and an alert can trigger automated recovery."
    },
    prometheus: {
        title: "Prometheus",
        description: "Metrics collection and alert evaluation",
        endpoint: "Endpoint: http://localhost:9090",
        role: "Scrapes configured targets, evaluates alert rules, and exposes monitoring metrics."
    },
    alertmanager: {
        title: "Alertmanager",
        description: "Alert routing and notification management",
        endpoint: "Endpoint: http://localhost:9093",
        role: "Receives alerts from Prometheus and routes service-failure alerts to the recovery controller."
    },
    recovery: {
        title: "Recovery Controller",
        description: "Automated incident recovery",
        endpoint: "Endpoint: Internal Docker network — port 5002",
        role: "Receives eligible alerts, applies cooldown protection, and invokes the Ansible recovery playbook."
    }
};

const serviceRows = document.querySelectorAll(".service-clickable");
const detailsPanel = document.getElementById("service-details");
const detailTitle = document.getElementById("service-detail-title");
const detailDescription = document.getElementById("service-detail-description");
const detailEndpoint = document.getElementById("service-detail-endpoint");
const detailRole = document.getElementById("service-detail-role");
const closeDetailsButton = document.getElementById("close-service-details");

function showServiceDetails(serviceKey) {
    const service = serviceDetails[serviceKey];

    if (!service || !detailsPanel) return;

    detailTitle.textContent = service.title;
    detailDescription.textContent = service.description;
    detailEndpoint.textContent = service.endpoint;
    detailRole.textContent = service.role;

    detailsPanel.hidden = false;
    detailsPanel.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
    });
}

serviceRows.forEach(row => {
    row.addEventListener("click", () => {
        showServiceDetails(row.dataset.service);
    });

    row.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            showServiceDetails(row.dataset.service);
        }
    });
});

if (closeDetailsButton && detailsPanel) {
    closeDetailsButton.addEventListener("click", () => {
        detailsPanel.hidden = true;
    });
}
