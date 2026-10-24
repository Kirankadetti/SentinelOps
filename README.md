\# SentinelOps — Self-Healing Infrastructure \& Intelligent Incident Recovery



\## 1. Project Overview



SentinelOps is a DevOps automation project that monitors service availability, detects failures, and initiates automated recovery using Prometheus, Alertmanager, and Ansible.



\## 2. Objectives



\- Monitor NGINX availability using Blackbox Exporter.

\- Detect service failures through Prometheus alert rules.

\- Route alerts from Alertmanager to a recovery controller.

\- Execute an Ansible playbook for automated NGINX recovery.

\- Display service health, alerts, and recovery events on a dashboard.



\## 3. Technology Stack



\- Docker and Docker Compose

\- Python and Flask

\- Prometheus and Alertmanager

\- Blackbox Exporter

\- Ansible

\- NGINX

\- HTML, CSS, and JavaScript



\## 4. Architecture and Workflow



1\. Blackbox Exporter probes the NGINX service.

2\. Prometheus evaluates metrics and configured alert rules.

3\. Alertmanager sends matching alerts to the recovery controller.

4\. The recovery controller invokes the Ansible recovery playbook.

5\. The dashboard displays service status and recovery events.



\## 5. Project Structure



\- `app/` — Flask dashboard and API.

\- `monitoring/prometheus/` — Prometheus and Blackbox Exporter configuration.

\- `monitoring/alertmanager/` — Alertmanager configuration.

\- `recovery/` — Recovery controller and Ansible playbook.

\- `evidence/` — Demonstration screenshots.

\- `docs/` — Project report.

\- `tests/` — Reserved for automated tests if added.



\## 6. Running the Project



Prerequisite: Docker Desktop with Docker Compose.



Run these commands from the project root:



```powershell

docker compose config

docker compose up -d --build

docker compose ps

```



Dashboard: http://localhost:5001  

Prometheus: http://localhost:9090  

Alertmanager: http://localhost:9093  

NGINX target: http://localhost:8081



\## 7. Verification



Check the API and NGINX target:



```powershell

Invoke-WebRequest http://localhost:5001/health -UseBasicParsing

Invoke-WebRequest http://localhost:8081 -UseBasicParsing

```



Both endpoints returned HTTP 200 during the latest verification.



\## 8. Evidence



The `evidence/` directory contains screenshots of the dashboard, Prometheus alert rules, Alertmanager configuration, recovery events, recovery logs, and NGINX restoration.



\## 9. Limitations



The current implementation demonstrates service-availability alerting and NGINX recovery. CPU usage alerting above 90% has not been implemented.



\## 10. Conclusion



SentinelOps demonstrates an automated monitoring and recovery workflow using open-source DevOps tools, combining service probing, alert evaluation, alert routing, Ansible recovery, and dashboard visibility.

