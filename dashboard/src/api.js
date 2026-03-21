/**
 * NetPulse API Client
 * All fetch functions map to the FastAPI backend endpoints.
 */

const API_BASE = '/api';

async function fetchJSON(url, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${url}`, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`API call failed: ${url}`, err.message);
    return null;
  }
}

// ─── PC endpoints ─────────────────────────────────────────────────────────────

export async function fetchPCs() {
  return fetchJSON('/pcs');
}

export async function fetchPCLatest(pcId) {
  return fetchJSON(`/pcs/${encodeURIComponent(pcId)}/latest`);
}

export async function fetchPCHistory(pcId, range = '1h', limit = 100) {
  return fetchJSON(`/pcs/${encodeURIComponent(pcId)}/history?range=${range}&limit=${limit}`);
}

// ─── Overview / summaries ─────────────────────────────────────────────────────

// FIX: use /summaries (fast per-PC docs) not /overview (slow aggregation)
export async function fetchSummaries() {
  return fetchJSON('/summaries');
}

// Fleet-wide KPI numbers (total PCs, avg cpu, alert count etc.)
export async function fetchOverview() {
  return fetchJSON('/overview');
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export async function fetchAlerts({ limit = 50, severity, category, pcId, resolved = false } = {}) {
  const params = new URLSearchParams({ limit, resolved });
  if (severity) params.set('severity', severity);
  if (category) params.set('category', category);
  if (pcId) params.set('pc_id', pcId);
  return fetchJSON(`/alerts?${params}`);
}

export async function resolveAlert(alertId) {
  return fetchJSON(`/alerts/${alertId}/resolve`, { method: 'PATCH' });
}

// ─── Security ─────────────────────────────────────────────────────────────────

export async function fetchThreatIPs(limit = 20) {
  return fetchJSON(`/security/threat-ips?limit=${limit}`);
}

// ─── Stats / analytics ────────────────────────────────────────────────────────

export async function fetchStats(range = '1h') {
  return fetchJSON(`/stats?range=${range}`);
}

// ─── Fleet-wide history (All PCs aggregated) ──────────────────────────────────

export async function fetchFleetHistory(range = '1h', limit = 100) {
  return fetchJSON(`/fleet/history?range=${range}&limit=${limit}`);
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function fetchHealth() {
  return fetchJSON('/health');
}

// ─── Demo data (used when API is unreachable) ─────────────────────────────────

export function generateDemoSummaries() {
  const pcs = [
    'LAB-PC-01', 'LAB-PC-02', 'LAB-PC-03',
    'OFFICE-PC-01', 'OFFICE-PC-02',
    'SERVER-01', 'SERVER-02',
    'DEV-PC-01', 'DEV-PC-02',
  ];
  const now = Date.now() / 1000;

  const summaries = pcs.map((id, i) => {
    const cpu = +(20 + Math.random() * 50).toFixed(1);
    const mem = +(40 + Math.random() * 45).toFixed(1);
    const disk = +(30 + Math.random() * 55).toFixed(1);
    const ports = [80, 443, 3306, 8080, 27017].slice(0, 2 + Math.floor(Math.random() * 3));

    return {
      pc_id: id,
      last_seen: now - Math.random() * 60,
      uptime_seconds: 86400 * (1 + i % 5) + Math.floor(Math.random() * 43200),
      latest_cpu: cpu,
      latest_memory: mem,
      latest_disk: disk,
      latest_connections: Math.floor(10 + Math.random() * 40),
      latest_bytes_rx: Math.floor(100000 + Math.random() * 8000000),
      latest_bytes_tx: Math.floor(50000 + Math.random() * 5000000),
      avg_cpu: +(cpu - Math.random() * 5).toFixed(1),
      avg_memory: +(mem - Math.random() * 5).toFixed(1),
      avg_disk: +(disk - Math.random() * 2).toFixed(1),
      listening_ports: ports,
      listening_port_count: ports.length,
      top_processes: [
        { name: 'chrome.exe', cpu: +(2 + Math.random() * 13).toFixed(1), memory: +(5 + Math.random() * 15).toFixed(1) },
        { name: 'python.exe', cpu: +(1 + Math.random() * 9).toFixed(1), memory: +(3 + Math.random() * 9).toFixed(1) },
        { name: 'vscode.exe', cpu: +(0.5 + Math.random() * 7).toFixed(1), memory: +(4 + Math.random() * 11).toFixed(1) },
      ],
      fw_top_blocked_ip: Math.random() > 0.5 ? `${Math.floor(Math.random() * 223)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}` : null,
      fw_blocked_total: Math.floor(Math.random() * 30),
      risk_score: Math.floor(10 + Math.random() * 60),
      anomaly_score: Math.random() > 0.8 ? Math.floor(40 + Math.random() * 60) : Math.floor(Math.random() * 40),
      is_anomaly: Math.random() > 0.85,
      samples_analysed: Math.floor(20 + Math.random() * 80),
    };
  });

  return { summaries };
}

export function generateDemoOverview(summaries = []) {
  const n = summaries.length || 1;
  return {
    total_pcs: summaries.length,
    online_pcs: summaries.filter(s => (Date.now() / 1000 - s.last_seen) < 180).length,
    avg_cpu: +(summaries.reduce((a, s) => a + s.latest_cpu, 0) / n).toFixed(1),
    avg_memory: +(summaries.reduce((a, s) => a + s.latest_memory, 0) / n).toFixed(1),
    total_connections: summaries.reduce((a, s) => a + s.latest_connections, 0),
    total_alerts: summaries.filter(s => s.is_anomaly).length,
  };
}

export function generateDemoHistory(pcId, range = '1h') {
  const rangeSec = { '1h': 3600, '6h': 21600, '24h': 86400 }[range] || 3600;
  const points = range === '1h' ? 60 : range === '6h' ? 72 : 96;
  const interval = rangeSec / points;
  const now = Date.now() / 1000;

  const data = Array.from({ length: points }, (_, i) => {
    const ts = now - (points - 1 - i) * interval;
    const tcp = Math.floor(10 + Math.random() * 40);
    const udp = Math.floor(3 + Math.random() * 15);
    return {
      pc_id: pcId,
      timestamp: ts,
      cpu_usage: +(25 + 15 * Math.sin(i / 5) + (Math.random() - 0.5) * 10).toFixed(1),
      memory_usage: +(55 + 10 * Math.cos(i / 8) + (Math.random() - 0.5) * 6).toFixed(1),
      disk_usage: +(45 + (Math.random() - 0.5) * 4).toFixed(1),
      bytes_sent: Math.floor(100000 + Math.random() * 4000000),
      bytes_received: Math.floor(200000 + Math.random() * 6000000),
      packets_sent: Math.floor(200 + Math.random() * 4000),
      packets_received: Math.floor(300 + Math.random() * 6000),
      tcp_count: tcp,
      udp_count: udp,
      total_connections: tcp + udp,
      unique_remote_ips: Math.floor(3 + Math.random() * 27),
      total_processes: Math.floor(80 + Math.random() * 170),
      // FIX: field name is cpu not cpu%
      top_processes: [
        { name: 'chrome.exe', cpu: +(2 + Math.random() * 13).toFixed(1), memory: +(5 + Math.random() * 15).toFixed(1) },
        { name: 'python.exe', cpu: +(1 + Math.random() * 9).toFixed(1), memory: +(3 + Math.random() * 9).toFixed(1) },
        { name: 'vscode.exe', cpu: +(0.5 + Math.random() * 7).toFixed(1), memory: +(4 + Math.random() * 11).toFixed(1) },
      ],
      firewall: {
        blocked_count: Math.floor(Math.random() * 20),
        allowed_count: Math.floor(50 + Math.random() * 400),
        blocked_ips: [],
        blocked_ports: [],
        top_blocked_ip: null,
      },
      suspicious_port_access: Math.random() > 0.9 ? 1 : 0,
      potential_port_scan: Math.random() > 0.95 ? 1 : 0,
    };
  });

  return { pc_id: pcId, range, data };
}

export function generateDemoAlerts() {
  const pcs = ['LAB-PC-01', 'SERVER-01', 'OFFICE-PC-02', 'DEV-PC-01'];
  const now = Date.now() / 1000;
  const defs = [
    { severity: 'critical', category: 'security', message: 'Suspicious port access detected (2 connections)' },
    { severity: 'critical', category: 'security', message: 'Potential port scan on 3 local port(s)' },
    { severity: 'warning', category: 'firewall', message: 'High firewall block rate: 58 blocks. Top IP: 45.33.32.156' },
    { severity: 'warning', category: 'system', message: 'Disk usage high: 87.2%' },
    { severity: 'warning', category: 'anomaly', message: 'ML anomaly detected — score: 74/100' },
    { severity: 'info', category: 'network', message: 'New listening port detected: 8443' },
  ];

  const alerts = Array.from({ length: 20 }, (_, i) => {
    const def = defs[i % defs.length];
    return {
      ...def,
      pc_id: pcs[i % pcs.length],
      timestamp: now - i * 180 - Math.random() * 60,
      value: Math.floor(Math.random() * 100),
      resolved: false,
    };
  });

  return { alerts, total: alerts.length };
}