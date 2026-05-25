const budget = 98000;

const resources = [
  {
    id: "i-0af31-prod-api",
    provider: "AWS",
    service: "EC2 m6i.2xlarge",
    owner: "Core API",
    environment: "production",
    tag: "team:core-api",
    monthlyCost: 7840,
    utilization: 7,
    anomaly: "Idle outside deploy windows",
    evidence: "CPU below 8% for 19 of the last 21 nights; no customer traffic after 20:00 UTC.",
    risk: "low",
    guardrail: "Stop only after health checks pass and keep rollback warm for 30 minutes.",
    action: "Schedule nightly stop for idle API instance",
    savings: 6120,
    confidence: 94,
    status: "recommended",
  },
  {
    id: "aks-ml-notebook-pool",
    provider: "Azure",
    service: "AKS GPU node pool",
    owner: "ML Platform",
    environment: "experiment",
    tag: "team:ml-platform",
    monthlyCost: 12400,
    utilization: 12,
    anomaly: "GPU pool idle for 9 days",
    evidence: "Zero GPU memory allocation since the last training run; notebook namespace has no active pods.",
    risk: "medium",
    guardrail: "Require owner approval and keep infrastructure-as-code rollback plan attached.",
    action: "Scale idle GPU node pool to zero",
    savings: 10100,
    confidence: 91,
    status: "needs-owner",
  },
  {
    id: "gke-checkout-blue",
    provider: "GCP",
    service: "GKE checkout deployment",
    owner: "Growth",
    environment: "staging",
    tag: "release:blue-env",
    monthlyCost: 5260,
    utilization: 19,
    anomaly: "Duplicate blue environment has no traffic",
    evidence: "Load balancer logs show 0.0% request share for 72 hours after green release.",
    risk: "low",
    guardrail: "Run synthetic smoke test against green before suspending blue.",
    action: "Suspend unused blue checkout environment",
    savings: 4020,
    confidence: 96,
    status: "recommended",
  },
  {
    id: "snap-legacy-2024",
    provider: "AWS",
    service: "EBS snapshot set",
    owner: "Unknown",
    environment: "legacy",
    tag: "untagged",
    monthlyCost: 2180,
    utilization: 0,
    anomaly: "Snapshot set has no restore events",
    evidence: "No restore event in 14 months and no matching active volume tag.",
    risk: "low",
    guardrail: "Notify Slack channel and archive for 7 days before deletion.",
    action: "Archive orphaned snapshot set",
    savings: 1740,
    confidence: 89,
    status: "recommended",
  },
  {
    id: "sql-reporting-eastus",
    provider: "Azure",
    service: "SQL Database Premium",
    owner: "Finance Ops",
    environment: "production",
    tag: "team:finance",
    monthlyCost: 6900,
    utilization: 31,
    anomaly: "Database provisioned above p95 workload",
    evidence: "DTU peaks at 28% and memory pressure is normal across month-end reporting.",
    risk: "medium",
    guardrail: "Apply during maintenance window and monitor query latency for 24 hours.",
    action: "Resize reporting database to 2 vCore",
    savings: 3900,
    confidence: 87,
    status: "needs-owner",
  },
  {
    id: "cdn-media-egress",
    provider: "GCP",
    service: "Cloud CDN egress",
    owner: "Content",
    environment: "production",
    tag: "customer-facing",
    monthlyCost: 9900,
    utilization: 88,
    anomaly: "Origin fetch rate increased sharply",
    evidence: "Cache hit rate fell from 91% to 63% after last media release.",
    risk: "high",
    guardrail: "Create a config change PR; do not automate because customer traffic path changes.",
    action: "Tune cache headers for media assets",
    savings: 2600,
    confidence: 84,
    status: "review-only",
  },
  {
    id: "nat-az1-spike",
    provider: "AWS",
    service: "NAT Gateway us-east-1a",
    owner: "Platform",
    environment: "production",
    tag: "network:shared",
    monthlyCost: 4360,
    utilization: 41,
    anomaly: "Cross-AZ data processing spike",
    evidence: "41% of traffic now traverses availability zones after a subnet routing change.",
    risk: "medium",
    guardrail: "Open routing PR and run connection drain checks before apply.",
    action: "Route workload through same-zone NAT gateway",
    savings: 2300,
    confidence: 88,
    status: "needs-owner",
  },
  {
    id: "cr-logs-hot-retention",
    provider: "GCP",
    service: "Cloud Logging retention",
    owner: "Security",
    environment: "shared",
    tag: "audit",
    monthlyCost: 3180,
    utilization: 4,
    anomaly: "Debug logs retained in hot storage",
    evidence: "Verbose application logs exceed audit requirements by 23 days.",
    risk: "low",
    guardrail: "Keep audit and incident response labels untouched.",
    action: "Move debug logs to cold retention tier",
    savings: 2140,
    confidence: 93,
    status: "recommended",
  },
];

const providerWeights = { AWS: 0.46, GCP: 0.29, Azure: 0.25 };
const spendHistory = [74200, 76800, 79100, 82400, 84600, 87200, 90300, 92100, 94600, 97200, 100900, 104300];
const scanFindings = [
  "Detected a new cross-zone transfer pattern in shared networking.",
  "Updated rightsizing confidence from fresh p95 utilization windows.",
  "Matched untagged storage to owner history and deploy logs.",
  "Replayed current approvals against policy-as-code guardrails.",
];

let approvedActions = new Set();
let snoozedActions = new Set();
let activeProvider = "all";
let scenario = "baseline";
let searchTerm = "";
let autopilotEnabled = false;
let scanCount = 0;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function providerWeight(provider) {
  return provider === "all" ? 1 : providerWeights[provider];
}

function resourceCorpus(resource) {
  return [
    resource.id,
    resource.provider,
    resource.service,
    resource.owner,
    resource.environment,
    resource.tag,
    resource.anomaly,
    resource.risk,
    resource.evidence,
  ]
    .join(" ")
    .toLowerCase();
}

function visibleResources() {
  return resources.filter((resource) => {
    const providerMatch = activeProvider === "all" || resource.provider === activeProvider;
    const searchMatch = resourceCorpus(resource).includes(searchTerm.toLowerCase());
    return providerMatch && searchMatch && !snoozedActions.has(resource.id);
  });
}

function scenarioSavings() {
  const visible = visibleResources();
  if (scenario === "full") return visible.reduce((sum, resource) => sum + resource.savings, 0);
  if (scenario === "approved") {
    return visible
      .filter((resource) => approvedActions.has(resource.id))
      .reduce((sum, resource) => sum + resource.savings, 0);
  }
  return autopilotEnabled
    ? visible.filter((resource) => resource.risk === "low").reduce((sum, resource) => sum + resource.savings, 0)
    : 0;
}

function buildForecast() {
  const recentChanges = spendHistory.slice(-5).map((value, index, array) => (index === 0 ? 0 : value - array[index - 1]));
  const averageGrowth = recentChanges.reduce((sum, value) => sum + value, 0) / (recentChanges.length - 1);
  const savingsRamp = scenarioSavings() / 4;

  return Array.from({ length: 6 }, (_, index) => {
    const gross = spendHistory.at(-1) + averageGrowth * (index + 1);
    const optimized = gross - savingsRamp * Math.min(index + 1, 4);
    return Math.round(optimized * providerWeight(activeProvider));
  });
}

function calculateMetrics() {
  const currentSpend = Math.round(spendHistory.at(-1) * providerWeight(activeProvider));
  const forecast = buildForecast();
  const projected = forecast.at(-1);
  const visible = visibleResources();
  const savings = visible.reduce((sum, resource) => sum + resource.savings, 0);
  const approvedSavings = visible
    .filter((resource) => approvedActions.has(resource.id))
    .reduce((sum, resource) => sum + resource.savings, 0);

  return {
    currentSpend,
    projected,
    savings,
    approvedSavings,
    wasteScore: Math.round((savings / Math.max(currentSpend, 1)) * 100),
    overrun: Math.max(projected - budget * providerWeight(activeProvider), 0),
    spendDelta: Math.round(((spendHistory.at(-1) - spendHistory.at(-2)) / spendHistory.at(-2)) * 100),
  };
}

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function riskRank(risk) {
  return { low: 1, medium: 2, high: 3 }[risk];
}

function renderMetrics() {
  const metrics = calculateMetrics();
  setText("#monthlySpend", currency.format(metrics.currentSpend));
  setText("#detectedSavings", currency.format(metrics.savings));
  setText("#wasteScore", `${metrics.wasteScore}%`);
  setText("#overrun", currency.format(metrics.overrun));
  setText("#spendDelta", `${metrics.spendDelta}% increase since last scan`);
  setText("#lastScanLabel", `Last scan completed ${Math.max(1, 3 - scanCount)} minutes ago across AWS, GCP, and Azure.`);
}

function renderForecast() {
  const canvas = document.querySelector("#forecastChart");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = { top: 28, right: 30, bottom: 42, left: 72 };
  const actual = spendHistory.map((value) => Math.round(value * providerWeight(activeProvider)));
  const forecast = buildForecast();
  const localBudget = budget * providerWeight(activeProvider);
  const points = [...actual, ...forecast, localBudget];
  const max = Math.ceil(Math.max(...points) / 10000) * 10000;
  const min = Math.max(0, Math.floor(Math.min(...points) / 10000) * 10000 - 10000);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcf8";
  ctx.fillRect(0, 0, width, height);

  const x = (index, total) => padding.left + (chartWidth / (total - 1)) * index;
  const y = (value) => padding.top + chartHeight - ((value - min) / (max - min)) * chartHeight;

  ctx.strokeStyle = "#dfe6dd";
  ctx.lineWidth = 1;
  ctx.font = "13px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#5f6f66";

  for (let step = 0; step <= 4; step += 1) {
    const value = min + ((max - min) / 4) * step;
    const lineY = y(value);
    ctx.beginPath();
    ctx.moveTo(padding.left, lineY);
    ctx.lineTo(width - padding.right, lineY);
    ctx.stroke();
    ctx.fillText(currency.format(value), 12, lineY + 4);
  }

  ctx.strokeStyle = "#b56f21";
  ctx.setLineDash([7, 7]);
  ctx.beginPath();
  ctx.moveTo(padding.left, y(localBudget));
  ctx.lineTo(width - padding.right, y(localBudget));
  ctx.stroke();
  ctx.setLineDash([]);

  const totalPoints = actual.length + forecast.length;
  drawLine(ctx, actual, "#245d5f", x, y, 0, totalPoints);
  drawLine(ctx, [actual.at(-1), ...forecast], "#0f8b5f", x, y, actual.length - 1, totalPoints);

  ctx.fillStyle = "#5f6f66";
  ["W-11", "W-8", "W-5", "W-2", "Now", "+2w", "+4w"].forEach((label, index) => {
    ctx.fillText(label, x(index * 3, 18) - 13, height - 16);
  });
}

function drawLine(ctx, values, color, x, y, offset, total) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  values.forEach((value, index) => {
    const pointX = x(index + offset, total);
    const pointY = y(value);
    if (index === 0) ctx.moveTo(pointX, pointY);
    else ctx.lineTo(pointX, pointY);
  });
  ctx.stroke();

  ctx.fillStyle = color;
  values.forEach((value, index) => {
    ctx.beginPath();
    ctx.arc(x(index + offset, total), y(value), 4.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function renderBrief() {
  const visible = visibleResources();
  const top = [...visible].sort((a, b) => b.savings - a.savings).slice(0, 3);
  const metrics = calculateMetrics();
  const confidence = Math.round(top.reduce((sum, item) => sum + item.confidence, 0) / Math.max(top.length, 1));
  setText("#confidenceBadge", `${confidence || 92}% confidence`);
  setText(
    "#agentBrief",
    `The agent found ${visible.length} actionable cost signals worth ${currency.format(metrics.savings)} monthly. ` +
      `${currency.format(metrics.approvedSavings)} is already approved; ${currency.format(metrics.overrun)} remains at risk in the current forecast.`,
  );

  document.querySelector("#briefList").innerHTML = top
    .map(
      (resource) => `
        <div class="brief-item">
          <strong>${resource.provider} | ${resource.owner}</strong>
          <span>${resource.anomaly}. Expected impact ${currency.format(resource.savings)} monthly with ${resource.confidence}% confidence.</span>
        </div>
      `,
    )
    .join("");
}

function renderRecommendations() {
  const sorted = [...visibleResources()].sort((a, b) => b.savings - a.savings || riskRank(a.risk) - riskRank(b.risk));
  document.querySelector("#recommendationList").innerHTML = sorted
    .map((resource) => {
      const approved = approvedActions.has(resource.id);
      return `
        <article class="recommendation ${approved ? "approved" : ""}">
          <div class="rec-header">
            <div class="rec-title">
              <strong>${resource.action}</strong>
              <span>${resource.provider} | ${resource.service} | ${resource.id}</span>
            </div>
            <span class="pill ${resource.risk}">${resource.risk} risk</span>
          </div>
          <p>${resource.evidence}</p>
          <div class="rec-detail-grid">
            <span><b>Owner</b>${resource.owner}</span>
            <span><b>Utilization</b>${resource.utilization}% avg</span>
            <span><b>Savings</b>${currency.format(resource.savings)}/mo</span>
            <span><b>Guardrail</b>${resource.guardrail}</span>
          </div>
          <div class="rec-actions">
            <button class="primary-button" type="button" data-approve="${resource.id}">${approved ? "Queued" : "Approve action"}</button>
            <button class="secondary-button" type="button" data-snooze="${resource.id}">Snooze 7 days</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderResources() {
  const visible = visibleResources();
  document.querySelector("#resourceTable").innerHTML =
    visible
      .map(
        (resource) => `
        <div class="resource-row">
          <div class="resource-main">
            <strong>${resource.service}</strong>
            <span class="resource-meta">${resource.provider} | ${resource.owner} | ${resource.environment} | ${resource.tag}</span>
          </div>
          <span class="pill ${resource.risk}">${resource.anomaly}</span>
          <span class="resource-cost">${currency.format(resource.monthlyCost)}</span>
        </div>
      `,
      )
      .join("") || `<p class="resource-meta">No matching cloud resources found.</p>`;
}

function renderAutomation() {
  const pending = resources.filter((resource) => approvedActions.has(resource.id));
  const safe = resources.filter((resource) => resource.risk === "low" && !approvedActions.has(resource.id) && !snoozedActions.has(resource.id));
  setText("#queueCount", `${pending.length} pending`);
  const timeline = [
    ...pending.map((resource) => ({
      title: `Queued: ${resource.service}`,
      body: `${resource.guardrail} Policy runbook will notify ${resource.owner} and attach a rollback plan.`,
      code: "OK",
    })),
    ...safe.slice(0, 3).map((resource) => ({
      title: `Ready: ${resource.service}`,
      body: `${currency.format(resource.savings)} monthly savings available after one-click approval.`,
      code: "AI",
    })),
  ];

  document.querySelector("#automationTimeline").innerHTML =
    timeline
      .map(
        (item) => `
        <div class="timeline-item">
          <span class="timeline-icon">${item.code}</span>
          <div>
            <strong>${item.title}</strong>
            <p>${item.body}</p>
          </div>
        </div>
      `,
      )
      .join("") || `<p class="resource-meta">No automation candidates are currently queued.</p>`;
}

function renderCommandOutput(message) {
  const metrics = calculateMetrics();
  document.querySelector("#commandOutput").innerHTML = `
    <div>
      <strong>Agent response</strong>
      <p>${message}</p>
    </div>
    <div class="mini-stats">
      <span>${visibleResources().length} findings</span>
      <span>${currency.format(metrics.savings)} opportunity</span>
      <span>${currency.format(metrics.overrun)} forecast overrun</span>
    </div>
  `;
}

function refresh() {
  renderMetrics();
  renderForecast();
  renderBrief();
  renderRecommendations();
  renderResources();
  renderAutomation();
}

function toast(message) {
  const toastElement = document.querySelector("#toast");
  toastElement.textContent = message;
  toastElement.classList.add("show");
  window.setTimeout(() => toastElement.classList.remove("show"), 2600);
}

function approve(resourceId) {
  approvedActions.add(resourceId);
  const resource = resources.find((item) => item.id === resourceId);
  toast(`${resource.service} optimization approved and queued.`);
}

function handleAgentCommand() {
  const input = document.querySelector("#agentCommand");
  const command = input.value.trim().toLowerCase();
  if (!command) {
    renderCommandOutput("Tell me what to investigate, approve, or forecast. Example: show idle gpu.");
    return;
  }

  if (command.includes("approve") && command.includes("low")) {
    resources
      .filter((resource) => resource.risk === "low")
      .forEach((resource) => approvedActions.add(resource.id));
    scenario = "approved";
    document.querySelector("#scenarioFilter").value = scenario;
    searchTerm = "";
    document.querySelector("#resourceSearch").value = searchTerm;
    activeProvider = "all";
    document.querySelector("#providerFilter").value = activeProvider;
    renderCommandOutput("Approved all low-risk actions and moved the forecast to the approved-savings scenario.");
  } else if (command.includes("gpu") || command.includes("ml")) {
    searchTerm = "gpu";
    document.querySelector("#resourceSearch").value = searchTerm;
    activeProvider = "Azure";
    document.querySelector("#providerFilter").value = activeProvider;
    renderCommandOutput("Focused the investigation on idle GPU capacity and Azure ML Platform ownership.");
  } else if (command.includes("azure") || command.includes("aws") || command.includes("gcp")) {
    activeProvider = command.includes("azure") ? "Azure" : command.includes("aws") ? "AWS" : "GCP";
    document.querySelector("#providerFilter").value = activeProvider;
    renderCommandOutput(`Filtered the estate to ${activeProvider} and recalculated forecast, savings, and overrun.`);
  } else if (command.includes("high risk") || command.includes("risky")) {
    searchTerm = "high";
    document.querySelector("#resourceSearch").value = searchTerm;
    renderCommandOutput("Showing high-risk findings only. These stay review-only because they affect customer traffic.");
  } else if (command.includes("forecast") || command.includes("runway")) {
    scenario = "full";
    document.querySelector("#scenarioFilter").value = scenario;
    renderCommandOutput("Showing the full optimization scenario so finance can see best-case runway protection.");
  } else {
    searchTerm = command;
    document.querySelector("#resourceSearch").value = searchTerm;
    renderCommandOutput("Searched the resource graph using your command text and refreshed the ranked findings.");
  }

  refresh();
}

document.querySelector("#providerFilter").addEventListener("change", (event) => {
  activeProvider = event.target.value;
  renderCommandOutput(`Filtered to ${activeProvider === "all" ? "all cloud providers" : activeProvider}.`);
  refresh();
});

document.querySelector("#scenarioFilter").addEventListener("change", (event) => {
  scenario = event.target.value;
  renderCommandOutput(`Forecast scenario changed to ${event.target.options[event.target.selectedIndex].text}.`);
  refresh();
});

document.querySelector("#resourceSearch").addEventListener("input", (event) => {
  searchTerm = event.target.value;
  refresh();
});

document.querySelector("#recommendationList").addEventListener("click", (event) => {
  const approveId = event.target.dataset.approve;
  const snoozeId = event.target.dataset.snooze;

  if (approveId) {
    approve(approveId);
    refresh();
  }

  if (snoozeId) {
    const resource = resources.find((item) => item.id === snoozeId);
    snoozedActions.add(snoozeId);
    toast(`${resource.service} recommendation snoozed for 7 days.`);
    refresh();
  }
});

document.querySelector("#approveSafe").addEventListener("click", () => {
  visibleResources()
    .filter((resource) => resource.risk === "low")
    .forEach((resource) => approvedActions.add(resource.id));
  scenario = "approved";
  document.querySelector("#scenarioFilter").value = scenario;
  renderCommandOutput("Bulk-approved low-risk recommendations with rollback guardrails.");
  toast("Low-risk actions approved with rollback guardrails.");
  refresh();
});

document.querySelector("#runScan").addEventListener("click", () => {
  scanCount += 1;
  const drift = autopilotEnabled ? 1.006 : 1.018;
  spendHistory.push(Math.round(spendHistory.at(-1) * drift));
  if (spendHistory.length > 14) spendHistory.shift();
  const finding = scanFindings[scanCount % scanFindings.length];
  renderCommandOutput(`Fresh scan completed. ${finding}`);
  toast("Fresh scan completed across billing, tags, metrics, and deploy history.");
  refresh();
});

document.querySelector("#autoPilot").addEventListener("click", (event) => {
  autopilotEnabled = !autopilotEnabled;
  event.target.textContent = autopilotEnabled ? "Safe autopilot enabled" : "Enable safe autopilot";
  event.target.classList.toggle("secondary-button", autopilotEnabled);
  event.target.classList.toggle("primary-button", !autopilotEnabled);
  if (autopilotEnabled) {
    resources.filter((resource) => resource.risk === "low").forEach((resource) => approvedActions.add(resource.id));
    scenario = "approved";
    document.querySelector("#scenarioFilter").value = scenario;
  }
  renderCommandOutput(
    autopilotEnabled
      ? "Autopilot is applying low-risk savings after policy checks; medium and high risk changes still require humans."
      : "Autopilot paused. Approved actions remain queued for manual review.",
  );
  toast(autopilotEnabled ? "Autopilot will apply low-risk savings after policy checks." : "Autopilot paused.");
  refresh();
});

document.querySelector("#runCommand").addEventListener("click", handleAgentCommand);
document.querySelector("#agentCommand").addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleAgentCommand();
});

renderCommandOutput("Monitoring billing exports, utilization metrics, deploy history, and resource tags.");
refresh();
