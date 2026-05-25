# cloudcost-sentinel

CloudCost Sentinel is a functional hackathon MVP for an AI-powered FinOps agent. It monitors a simulated AWS, GCP, and Azure estate, detects cost waste, forecasts cloud spend, and recommends safe optimization actions for DevOps teams.

## What It Solves

Startups often discover overspend only after the invoice arrives. This prototype gives engineering and finance teams an operational cockpit that answers:

- Which cloud resources are wasting money right now?
- How much will we overspend over the next 30 days?
- Which savings can be safely automated?
- Which actions need owner approval or a maintenance window?

## MVP Features

- Multi-cloud dashboard for AWS, GCP, and Azure.
- Cost KPIs for monthly spend, detected savings, waste score, and projected overrun.
- Canvas-based 30-day forecast with baseline, approved-savings, and full-optimization scenarios.
- AI-style recommendation engine with evidence, confidence, owner, risk, guardrail, and expected savings.
- Natural-language command bar for demo flows such as `show idle gpu`, `approve low risk`, and `forecast azure`.
- Approval workflow that moves recommendations into an automation queue.
- Safe autopilot mode that applies only low-risk actions with rollback guardrails.
- Search and provider filters for practical DevOps triage.
- Responsive UI that works as a static site with no build step.

## Product Approach

The agent is intentionally not a blind delete button. It explains why a resource is wasteful, who owns it, how much money is at stake, and what guardrails are required before any action runs. Low-risk findings can be bulk-approved; medium and high-risk findings stay in owner-review or PR-based workflows.

## AI And Automation Simulation

The prototype simulates the behavior of an AI FinOps agent by combining:

- Billing trend analysis.
- Utilization and traffic evidence.
- Tag and owner attribution.
- Risk classification.
- Policy-aware action routing.
- Forecast changes after approved optimizations.

In a production version, these signals would connect to AWS Cost Explorer, GCP Billing Export, Azure Cost Management, CloudWatch, Cloud Monitoring, Azure Monitor, Terraform plans, and Slack/Jira approval workflows.

## How To Run

Open `index.html` directly in a browser, or serve the folder with any static web server.

```bash
python -m http.server 4175
```

Then visit `http://127.0.0.1:4175/index.html`.

## Demo Flow

1. Review top KPIs and the forecast.
2. Switch forecast scenarios to compare baseline versus approved savings.
3. Type `show idle gpu` in the AI command bar to focus Azure GPU waste.
4. Type `approve low risk` or click **Approve low risk** to queue safe savings.
5. Enable safe autopilot to show guarded automation.
6. Run a fresh scan to simulate continuous monitoring.

