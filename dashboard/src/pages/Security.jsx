import { useState, useEffect, useMemo, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { fetchThreatIPs, fetchFleetHistory, fetchMLStatus, fetchAnomalies, generateDemoHistory } from '../api.js'

function timeAgo(ts) {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const PORT_NAMES = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 67: 'DHCP',
  445: 'SMB', 1900: 'SSDP', 3389: 'RDP',
  4444: 'Meterpreter', 5353: 'mDNS', 5900: 'VNC', 6667: 'IRC',
}

const TOOLTIP_STYLE = {
  backgroundColor: '#0f1923',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#e8e8f0',
}

// FIX: props renamed for clarity — summaries replaces overviewData.pcs
export default function Security({ alertsData, summaries = [], timeRange, alertsOnly = false }) {
  const [threatIPs, setThreatIPs] = useState([])
  const [filterSev, setFilterSev] = useState('all')
  const [filterCat, setFilterCat] = useState('all')
  const [mlStatus, setMlStatus] = useState(null)
  const [anomalies, setAnomalies] = useState([])
  const hasMounted = useRef(false)

  useEffect(() => {
    const timer = setTimeout(() => { hasMounted.current = true }, 500)
    return () => clearTimeout(timer)
  }, [])

  const animClass = hasMounted.current ? 'smooth-update' : 'animate-in'

  // FIX: fetch threat IPs from dedicated endpoint instead of deriving from overviewData
  useEffect(() => {
    async function load() {
      const res = await fetchThreatIPs(20)
      if (res?.threat_ips) {
        setThreatIPs(res.threat_ips)
      } else if (summaries.length) {
        const ipMap = {}
        summaries.forEach(s => {
          const ip = s.fw_top_blocked_ip
          if (ip) {
            if (!ipMap[ip]) ipMap[ip] = { ip, count: 0, pcs: [] }
            ipMap[ip].count += s.fw_blocked_total || 1
            ipMap[ip].pcs.push(s.pc_id)
          }
        })
        setThreatIPs(Object.values(ipMap).sort((a, b) => b.count - a.count))
      }

      // Wire ML status
      const mlRes = await fetchMLStatus()
      if (mlRes) setMlStatus(mlRes)

      // Wire anomalies
      const anomalyRes = await fetchAnomalies({ limit: 30 })
      if (anomalyRes?.anomalies) setAnomalies(anomalyRes.anomalies)
    }
    load()
  }, [summaries])

  // Security KPIs from summaries
  const kpis = useMemo(() => {
    if (!summaries.length) return { suspiciousPorts: 0, portScans: 0, firewallBlocked: 0, topBlockedIP: '—', anomalies: 0 }
    return {
      suspiciousPorts: 0,   // from alerts collection — not in summaries
      portScans: 0,   // from alerts collection
      firewallBlocked: summaries.reduce((s, p) => s + (p.fw_blocked_total || 0), 0),
      topBlockedIP: summaries.reduce((best, s) => {
        const ip = s.fw_top_blocked_ip
        return ip ? ip : best
      }, '—'),
      anomalies: summaries.filter(s => s.is_anomaly).length,
    }
  }, [summaries])

  // Blocked ports across all summaries — derive from alerts
  const blockedPorts = useMemo(() => {
    const portCounts = {}
      ; (alertsData?.alerts || []).forEach(a => {
        if (a.category === 'firewall' && Array.isArray(a.details?.blocked_ports)) {
          a.details.blocked_ports.forEach(p => {
            portCounts[p] = (portCounts[p] || 0) + 1
          })
        }
      })
    return Object.entries(portCounts)
      .map(([port, count]) => ({ port: Number(port), service: PORT_NAMES[port] || 'Unknown', count }))
      .sort((a, b) => b.count - a.count)
  }, [alertsData])

  // Firewall activity chart — fetch from actual fleet history (not sparse alerts)
  const [firewallChartData, setFirewallChartData] = useState([])

  useEffect(() => {
    let isMounted = true
    async function loadFirewallHistory() {
      const res = await fetchFleetHistory(timeRange, 100)
      if (!isMounted) return
      if (res?.data && res.data.length > 0) {
        // Each history point has firewall.blocked_count — aggregate into chart data
        const points = res.data.map(d => ({
          time: new Date(d.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          blocked: d.firewall_blocked || d.firewall?.blocked_count || 0,
          timestamp: d.timestamp,
        }))
        // Sort by timestamp to ensure chronological order
        points.sort((a, b) => a.timestamp - b.timestamp)
        setFirewallChartData(points.slice(-30))
      } else {
        // Fallback: derive from alert data if fleet history is unavailable
        const buckets = {}
        const alertList = alertsData?.alerts || []
        alertList.forEach(a => {
          if (a.category !== 'firewall') return
          const time = new Date(a.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          if (!buckets[a.timestamp]) buckets[a.timestamp] = { time, blocked: 0, timestamp: a.timestamp }
          buckets[a.timestamp].blocked += (a.value || 1)
        })
        const sorted = Object.values(buckets).sort((a, b) => a.timestamp - b.timestamp)
        setFirewallChartData(sorted.slice(-20))
      }
    }
    loadFirewallHistory()
    // Refresh firewall data every 60s
    const interval = setInterval(loadFirewallHistory, 60_000)
    return () => { isMounted = false; clearInterval(interval) }
  }, [timeRange, alertsData])

  // Filtered alerts
  const alerts = useMemo(() => {
    let list = alertsData?.alerts || []
    if (filterSev !== 'all') list = list.filter(a => a.severity === filterSev)
    if (filterCat !== 'all') list = list.filter(a => a.category === filterCat)
    return list
  }, [alertsData, filterSev, filterCat])

  return (
    <div>
      {/* ── Security KPIs ── */}
      {!alertsOnly && (
        <div className="kpi-grid">
          <div className={`kpi-card ${animClass} ${kpis.anomalies > 0 ? 'danger' : ''}`}>
            <div className="kpi-icon">🤖</div>
            <div className="kpi-label">ML Anomalies</div>
            <div className={`kpi-value ${kpis.anomalies > 0 ? 'red' : 'green'}`}>{kpis.anomalies}</div>
            <div className="kpi-subtitle">Isolation Forest flags</div>
          </div>
          <div className={`kpi-card ${animClass}`}>
            <div className="kpi-icon">🚫</div>
            <div className="kpi-label">Firewall Blocked</div>
            <div className={`kpi-value ${kpis.firewallBlocked > 50 ? 'red' : ''}`}>{kpis.firewallBlocked}</div>
            <div className="kpi-subtitle">Total across fleet</div>
          </div>
          <div className={`kpi-card ${animClass}`}>
            <div className="kpi-icon">🎯</div>
            <div className="kpi-label">Threat IPs</div>
            <div className="kpi-value amber">{threatIPs.length}</div>
            <div className="kpi-subtitle">Unique blocked sources</div>
          </div>
          <div className={`kpi-card danger ${animClass}`}>
            <div className="kpi-icon">📌</div>
            <div className="kpi-label">Top Blocked IP</div>
            <div className="kpi-value red" style={{ fontSize: 14, letterSpacing: 0, fontFamily: 'monospace' }}>
              {kpis.topBlockedIP}
            </div>
            <div className="kpi-subtitle">Most blocked source</div>
          </div>
        </div>
      )}

      {/* ── Firewall Activity Chart ── */}
      {!alertsOnly && firewallChartData.length > 0 && (
        <div className={`chart-card ${animClass}`}>
          <div className="chart-header">
            <span className="chart-title">Firewall Block Activity</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={firewallChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="time" stroke="#555577" fontSize={11} tickLine={false} />
              <YAxis stroke="#555577" fontSize={11} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="blocked" name="Blocked" fill="#ff4757" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Threat IPs + Blocked Ports ── */}
      {!alertsOnly && (
        <div className="chart-grid">
          <div className={`chart-card ${animClass}`}>
            <div className="chart-header">
              <span className="chart-title">Threat IPs</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{threatIPs.length} IPs</span>
            </div>
            <div className="data-table-wrapper" style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table className="data-table">
                <thead><tr><th>IP Address</th><th>Blocks</th><th>Affected PCs</th></tr></thead>
                <tbody>
                  {threatIPs.map(row => (
                    <tr key={row.ip}>
                      <td><span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--accent-red)' }}>{row.ip}</span></td>
                      <td style={{ fontWeight: 600, color: 'var(--accent-red)' }}>{row.count}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{(row.pcs || []).join(', ')}</td>
                    </tr>
                  ))}
                  {threatIPs.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No threat IPs</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className={`chart-card ${animClass}`}>
            <div className="chart-header">
              <span className="chart-title">Blocked Ports</span>
            </div>
            <div className="data-table-wrapper" style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table className="data-table">
                <thead><tr><th>Port</th><th>Service</th><th>Count</th></tr></thead>
                <tbody>
                  {blockedPorts.map(row => (
                    <tr key={row.port}>
                      <td><span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--accent-amber)' }}>{row.port}</span></td>
                      <td style={{ color: 'var(--text-secondary)' }}>{row.service}</td>
                      <td style={{ fontWeight: 600 }}>{row.count}</td>
                    </tr>
                  ))}
                  {blockedPorts.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No data yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Alert Feed ── */}
      <div className={`chart-card ${animClass}`}>
        <div className="chart-header">
          <span className="chart-title">{alertsOnly ? 'Alert Feed' : 'Alert Timeline'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* Severity filter */}
            {['all', 'critical', 'warning', 'info'].map(s => (
              <button key={s}
                onClick={() => setFilterSev(s)}
                style={{
                  padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                  border: 'none',
                  background: filterSev === s
                    ? s === 'critical' ? '#ff4757' : s === 'warning' ? '#ffb347' : s === 'info' ? '#00d4ff' : 'var(--accent-cyan)'
                    : 'var(--surface-2)',
                  color: filterSev === s ? '#fff' : 'var(--text-muted)',
                }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="timeline" style={{ maxHeight: 500, overflowY: 'auto' }}>
          {alerts.slice(0, 50).map((alert, i) => (
            <div className="timeline-item" key={i}>
              <div className={`timeline-dot ${alert.severity}`} />
              <div style={{ flex: 1 }}>
                <div className="timeline-msg">{alert.message}</div>
                <div className="timeline-meta">
                  <span>🖥️ {alert.pc_id}</span>
                  <span>🕐 {timeAgo(alert.timestamp)}</span>
                  <span style={{
                    padding: '1px 6px', borderRadius: 3, fontSize: 10,
                    background: alert.severity === 'critical' ? 'rgba(255,71,87,0.2)' : alert.severity === 'warning' ? 'rgba(255,179,71,0.2)' : 'rgba(0,212,255,0.2)',
                    color: alert.severity === 'critical' ? '#ff4757' : alert.severity === 'warning' ? '#ffb347' : '#00d4ff',
                  }}>
                    {alert.severity}
                  </span>
                  {alert.category && (
                    <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                      {alert.category}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {alerts.length === 0 && (
            <div className="empty-state">
              <div className="icon">🛡️</div>
              <p>No alerts {filterSev !== 'all' ? `with severity "${filterSev}"` : ''} — all clear!</p>
            </div>
          )}
        </div>
      </div>

      {/* ── ML Status Card ── */}
      {!alertsOnly && (
        <div className={`chart-card ${animClass}`}>
          <div className="chart-header">
            <span className="chart-title">🤖 ML Model Status</span>
            {mlStatus?.model_available && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(0,255,136,0.15)', color: '#00ff88' }}>ACTIVE</span>
            )}
          </div>
          {mlStatus ? (
            mlStatus.model_available ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 16, padding: '16px 24px' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Trained At</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{mlStatus.trained_at ? new Date(mlStatus.trained_at).toLocaleDateString() : '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Training Samples</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#00d4ff' }}>{(mlStatus.total_samples ?? '—').toLocaleString?.() ?? mlStatus.total_samples}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Unique PCs</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{mlStatus.unique_pcs ?? '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Estimators</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{mlStatus.n_estimators ?? '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Contamination</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{mlStatus.contamination != null ? `${(mlStatus.contamination * 100).toFixed(0)}%` : '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Score Mean</div>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}>{mlStatus.score_stats?.mean?.toFixed(4) ?? '—'}</div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '20px 24px', color: 'var(--text-muted)', fontSize: 13 }}>
                ⚠️ {mlStatus.message || 'No trained model — analyser will auto-train when 50+ logs collected.'}
              </div>
            )
          ) : (
            <div style={{ padding: '20px 24px', color: 'var(--text-muted)', fontSize: 13 }}>Loading ML status…</div>
          )}
        </div>
      )}

      {/* ── ML Anomaly Detections ── */}
      {!alertsOnly && anomalies.length > 0 && (
        <div className={`chart-card ${animClass}`}>
          <div className="chart-header">
            <span className="chart-title">🔍 ML Anomaly Detections</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{anomalies.length} recent</span>
          </div>
          <div className="data-table-wrapper" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>PC</th><th>Risk Score</th><th>Severity</th><th>Time</th><th>Method</th></tr></thead>
              <tbody>
                {anomalies.map((a, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{a.pc_id}</td>
                    <td>
                      <span style={{ fontWeight: 700, color: (a.value || 0) >= 75 ? '#ff4757' : (a.value || 0) >= 50 ? '#ffb347' : '#00ff88' }}>
                        {a.value ?? '—'}/100
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 3, fontWeight: 600,
                        background: a.severity === 'critical' ? 'rgba(255,71,87,0.2)' : 'rgba(255,179,71,0.2)',
                        color: a.severity === 'critical' ? '#ff4757' : '#ffb347' }}>
                        {a.severity}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{timeAgo(a.timestamp)}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{a.detection_method ?? 'ml'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
