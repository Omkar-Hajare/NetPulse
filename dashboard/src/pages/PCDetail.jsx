import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { fetchPCLatest, fetchPCHistory, generateDemoHistory } from '../api.js'

// ─── Shared helpers ───────────────────────────────────────────────────────────

function formatTS(ts) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function formatBytes(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB'
  if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB'
  return b + ' B'
}
function formatUptime(seconds) {
  if (!seconds) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${d}d ${h}h ${m}m`
}
function riskColor(score) {
  if (score == null) return 'var(--text-muted)'
  if (score >= 70) return '#ff4757'
  if (score >= 30) return '#ffb347'
  return '#00ff88'
}
function statusDot(s) {
  if (!s) return '#555577'
  if (s.is_anomaly || (s.latest_cpu || 0) > 80 || (s.latest_memory || 0) > 90) return '#ff4757'
  if ((s.latest_cpu || 0) > 60 || (s.latest_memory || 0) > 75) return '#ffb347'
  return '#00ff88'
}

const HIGH_RISK_PORTS = new Set([4444, 1337, 31337, 5900, 6667, 12345, 54321])
const KNOWN_SAFE_PORTS = new Set([80, 443, 135, 139, 445, 3306, 8080, 9092, 27017])
const TOOLTIP_STYLE = {
  backgroundColor: '#0f1923', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#e8e8f0',
}

// ─── Mini progress bar ────────────────────────────────────────────────────────

function MiniBar({ value, warn = 70, critical = 90 }) {
  const color = value >= critical ? '#ff4757' : value >= warn ? '#ffb347' : '#00d4ff'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(value || 0, 100)}%`, height: '100%', borderRadius: 3, background: color, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: 11, minWidth: 34, textAlign: 'right', color: value >= critical ? '#ff4757' : value >= warn ? '#ffb347' : 'var(--text-muted)', fontWeight: value >= warn ? 600 : 400 }}>
        {value ?? '—'}%
      </span>
    </div>
  )
}

// ─── Port tag ─────────────────────────────────────────────────────────────────

function PortTag({ port, isNew = false }) {
  let bg = 'var(--surface-2)', color = 'var(--text-secondary)'
  if (HIGH_RISK_PORTS.has(port)) { bg = 'rgba(255,71,87,0.2)'; color = '#ff4757' }
  else if (isNew) { bg = 'rgba(255,179,71,0.2)'; color = '#ffb347' }
  else if (!KNOWN_SAFE_PORTS.has(port)) { bg = 'rgba(0,212,255,0.1)'; color = '#00d4ff' }
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', margin: '2px', borderRadius: 4, fontSize: 11, background: bg, color, fontFamily: 'monospace', fontWeight: 600 }}>
      {port}
    </span>
  )
}

// ─── Radial gauge ─────────────────────────────────────────────────────────────

function RadialGauge({ value, label, unit = '%', thresholds = [{ v: 80, c: '#ffb347' }, { v: 90, c: '#ff4757' }] }) {
  const circ = Math.PI * 45
  const offset = circ * (1 - Math.min((value || 0) / 100, 1))
  let color = '#00d4ff'
  for (const t of thresholds) { if ((value || 0) >= t.v) color = t.c }

  return (
    <div className="gauge-card">
      <svg className="gauge-svg" viewBox="0 0 120 75">
        <path d="M 10 65 A 50 50 0 0 1 110 65" className="gauge-track" />
        <path d="M 10 65 A 50 50 0 0 1 110 65" className="gauge-fill" stroke={color} strokeDasharray={`${circ}`} strokeDashoffset={offset} />
        <text x="60" y="55" textAnchor="middle" fill="#e8e8f0" fontSize="20" fontWeight="700">
          {typeof value === 'number' ? value.toFixed(1) : value ?? '—'}
        </text>
        <text x="60" y="70" textAnchor="middle" fill="#555577" fontSize="10">{unit}</text>
      </svg>
      <div className="gauge-label">{label}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PC CARD GRID — shown when no PC is selected (/pc)
// ═══════════════════════════════════════════════════════════════════════════════

function PCCardGrid({ summaries }) {
  const navigate = useNavigate()

  if (!summaries || summaries.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
        <div style={{ fontSize: 40 }}>🖥️</div>
        <div style={{ fontSize: 16, color: 'var(--text-muted)' }}>No PCs found</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Start a NetPulse agent to see machines here</div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>PC Detail</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          {summaries.length} monitored machine{summaries.length !== 1 ? 's' : ''} — click any card to view full details
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {summaries.map(s => {
          const dot = statusDot(s)
          return (
            <div
              key={s.pc_id}
              onClick={() => navigate(`/dashboard/pc/${encodeURIComponent(s.pc_id)}`)}
              style={{
                background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 12, padding: 20, cursor: 'pointer',
                transition: 'all 0.15s ease', position: 'relative', overflow: 'hidden',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.border = '1px solid rgba(0,212,255,0.35)'
                e.currentTarget.style.background = 'rgba(0,212,255,0.04)'
                e.currentTarget.style.transform = 'translateY(-2px)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.border = '1px solid rgba(255,255,255,0.07)'
                e.currentTarget.style.background = 'var(--surface)'
                e.currentTarget.style.transform = 'translateY(0)'
              }}
            >
              {/* Anomaly banner */}
              {s.is_anomaly && (
                <div style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(255,71,87,0.15)', borderLeft: '1px solid rgba(255,71,87,0.4)', borderBottom: '1px solid rgba(255,71,87,0.4)', borderBottomLeftRadius: 8, padding: '2px 10px', fontSize: 10, color: '#ff4757', fontWeight: 700 }}>
                  ⚠ ANOMALY
                </div>
              )}

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: dot, flexShrink: 0, boxShadow: `0 0 6px ${dot}` }} />
                <span style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{s.pc_id}</span>
                {s.risk_score != null && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: riskColor(s.risk_score), padding: '2px 8px', borderRadius: 4, background: s.risk_score >= 70 ? 'rgba(255,71,87,0.15)' : s.risk_score >= 30 ? 'rgba(255,179,71,0.15)' : 'rgba(0,255,136,0.1)' }}>
                    Risk {s.risk_score}/100
                  </span>
                )}
              </div>

              {/* Metric bars */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>CPU</div>
                  <MiniBar value={s.latest_cpu} warn={70} critical={90} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Memory</div>
                  <MiniBar value={s.latest_memory} warn={80} critical={95} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Disk</div>
                  <MiniBar value={s.latest_disk} warn={75} critical={90} />
                </div>
              </div>

              {/* Footer stats */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#00d4ff', fontFamily: 'monospace' }}>{s.latest_connections ?? '—'}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>connections</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#a855f7', fontFamily: 'monospace' }}>{s.listening_port_count ?? '—'}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>open ports</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'monospace', color: s.fw_top_blocked_ip ? '#ff4757' : '#00ff88' }}>
                    {s.fw_top_blocked_ip ? '🚫 blocked' : '✓ clear'}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>firewall</div>
                </div>
              </div>

              {/* Bottom row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 10, color: 'var(--text-muted)' }}>
                <span>⏱ {formatUptime(s.uptime_seconds)}</span>
                <span>{s.anomaly_score != null ? `ML: ${s.anomaly_score}/100` : 'ML: pending'}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PC DETAIL VIEW — shown when a specific PC is selected (/pc/:pcId)
// ═══════════════════════════════════════════════════════════════════════════════

function PCDetailView({ timeRange, onTimeRange }) {
  const { pcId } = useParams()
  const navigate = useNavigate()
  const [latest, setLatest] = useState(null)
  const [history, setHistory] = useState([])
  const [prevPorts, setPrevPorts] = useState(new Set())
  const [localRange, setLocalRange] = useState(timeRange || '1h')

  useEffect(() => {
    async function load() {
      const l = await fetchPCLatest(pcId)
      if (l) {
        setLatest(l)
      } else {
        const demo = generateDemoHistory(pcId, localRange)
        setLatest(demo.data[demo.data.length - 1])
      }
      const h = await fetchPCHistory(pcId, localRange)
      if (h?.data && h.data.length > 1) {
        setHistory(h.data)
        setPrevPorts(new Set(h.data[h.data.length - 2]?.listening_ports || []))
      } else {
        const demo = generateDemoHistory(pcId, localRange)
        setHistory(demo.data)
      }
    }
    load()
  }, [pcId, localRange])

  const handleRange = r => { setLocalRange(r); onTimeRange?.(r) }

  const chartData = useMemo(() => history.map(d => ({
    time: formatTS(d.timestamp),
    cpu: d.cpu_usage,
    memory: d.memory_usage,
    disk: d.disk_usage,
    bytesSent: d.bytes_sent,
    bytesRecv: d.bytes_received,
    fwBlocked: d.firewall?.blocked_count || 0,
    fwAllowed: d.firewall?.allowed_count || 0,
    connections: d.total_connections || 0,
  })), [history])

  if (!latest) {
    return (
      <div>
        <div className="gauge-grid">
          {[...Array(5)].map((_, i) => <div key={i} className="gauge-card loading-skeleton" style={{ height: 140 }} />)}
        </div>
        <div className="chart-card loading-skeleton" style={{ height: 300 }} />
      </div>
    )
  }

  const fw = latest.firewall || {}
  const currentPorts = new Set(latest.listening_ports || [])
  const newPorts = [...currentPorts].filter(p => prevPorts.size > 0 && !prevPorts.has(p))

  return (
    <div>
      {/* Header — back button goes to /pc (card grid) */}
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate('/dashboard/pc')}>← All PCs</button>
        <h2>{pcId}</h2>
        <span className="uptime">⏱ {formatUptime(latest.uptime_seconds)}</span>
        {latest.risk_score != null && (
          <span style={{ marginLeft: 12, padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: latest.risk_score >= 70 ? 'rgba(255,71,87,0.2)' : latest.risk_score >= 30 ? 'rgba(255,179,71,0.2)' : 'rgba(0,255,136,0.2)', color: latest.risk_score >= 70 ? '#ff4757' : latest.risk_score >= 30 ? '#ffb347' : '#00ff88' }}>
            Risk {latest.risk_score}/100
          </span>
        )}
      </div>

      {/* Gauges */}
      <div className="gauge-grid">
        <RadialGauge value={latest.cpu_usage} label="CPU Usage" thresholds={[{ v: 70, c: '#ffb347' }, { v: 90, c: '#ff4757' }]} />
        <RadialGauge value={latest.memory_usage} label="Memory Usage" thresholds={[{ v: 80, c: '#ffb347' }, { v: 95, c: '#ff4757' }]} />
        <RadialGauge value={latest.disk_usage} label="Disk Usage" thresholds={[{ v: 75, c: '#ffb347' }, { v: 90, c: '#ff4757' }]} />
        <div className="gauge-card">
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#00d4ff', fontFamily: 'monospace' }}>{latest.total_processes ?? '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>processes</div>
          </div>
          <div className="gauge-label">Total Processes</div>
        </div>
        <div className="gauge-card">
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#a855f7', fontFamily: 'monospace' }}>{latest.total_connections ?? '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>active</div>
          </div>
          <div className="gauge-label">Connections</div>
        </div>
      </div>

      {/* System metrics chart */}
      <div className="chart-card">
        <div className="chart-header">
          <span className="chart-title">System Metrics Over Time</span>
          <div className="range-toggles">
            {['1h', '6h', '24h'].map(r => (
              <button key={r} className={`range-btn ${localRange === r ? 'active' : ''}`} onClick={() => handleRange(r)}>
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="time" stroke="#555577" fontSize={11} tickLine={false} />
            <YAxis stroke="#555577" fontSize={11} tickLine={false} domain={[0, 100]} unit="%" />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <Line type="monotone" dataKey="cpu" name="CPU %" stroke="#00d4ff" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="memory" name="Memory %" stroke="#00ff88" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="disk" name="Disk %" stroke="#ffb347" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Network + Top Processes */}
      <div className="chart-grid">
        <div className="chart-card">
          <div className="chart-header"><span className="chart-title">Network I/O</span></div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="time" stroke="#555577" fontSize={11} tickLine={false} />
              <YAxis stroke="#555577" fontSize={11} tickLine={false} tickFormatter={v => formatBytes(v)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => formatBytes(v)} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Area type="monotone" dataKey="bytesSent" name="Sent" stroke="#00d4ff" fill="rgba(0,212,255,0.12)" strokeWidth={2} />
              <Area type="monotone" dataKey="bytesRecv" name="Received" stroke="#00ff88" fill="rgba(0,255,136,0.12)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <div className="chart-header"><span className="chart-title">Top Processes</span></div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>Process</th><th>CPU %</th><th>Memory %</th></tr></thead>
              <tbody>
                {(latest.top_processes || []).map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td style={{ color: (p.cpu || 0) > 20 ? '#ffb347' : 'var(--text-primary)' }}>{p.cpu ?? '—'}%</td>
                    <td style={{ color: (p.memory || 0) > 15 ? '#ffb347' : 'var(--text-primary)' }}>{p.memory ?? '—'}%</td>
                  </tr>
                ))}
                {!(latest.top_processes?.length) && (
                  <tr><td colSpan={3} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>No process data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Firewall panel */}
      <div className="chart-card">
        <div className="chart-header">
          <span className="chart-title">Firewall Activity</span>
          {fw.blocked_count > 0 && <span style={{ fontSize: 12, color: '#ff4757', fontWeight: 600 }}>{fw.blocked_count} blocked this cycle</span>}
        </div>
        <div className="chart-grid" style={{ padding: '0 0 16px' }}>
          <div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="time" stroke="#555577" fontSize={10} tickLine={false} />
                <YAxis stroke="#555577" fontSize={10} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="fwBlocked" name="Blocked" fill="#ff4757" radius={[3, 3, 0, 0]} />
                <Bar dataKey="fwAllowed" name="Allowed" fill="#00ff88" radius={[3, 3, 0, 0]} opacity={0.5} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Top blocked IP</div>
              <div style={{ fontFamily: 'monospace', fontSize: 14, color: fw.top_blocked_ip ? '#ff4757' : 'var(--text-muted)' }}>{fw.top_blocked_ip || 'None'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Blocked ports</div>
              <div>
                {(fw.blocked_ports || []).length > 0
                  ? (fw.blocked_ports || []).map(p => <PortTag key={p} port={p} />)
                  : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>None</span>}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Blocked IPs this cycle</div>
              <div>
                {(fw.blocked_ips || []).length > 0
                  ? (fw.blocked_ips || []).slice(0, 5).map(ip => (
                    <span key={ip} style={{ display: 'block', fontFamily: 'monospace', fontSize: 12, color: '#ff4757', marginBottom: 2 }}>{ip}</span>
                  ))
                  : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>None</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Connection details + listening ports */}
      <div className="chart-card">
        <div className="chart-header"><span className="chart-title">Connection Details</span></div>
        <div className="conn-info">
          <div className="conn-stat"><span className="conn-stat-label">TCP</span><span className="conn-stat-value" style={{ color: '#00d4ff' }}>{latest.tcp_count ?? '—'}</span></div>
          <div className="conn-stat"><span className="conn-stat-label">UDP</span><span className="conn-stat-value" style={{ color: '#00ff88' }}>{latest.udp_count ?? '—'}</span></div>
          <div className="conn-stat"><span className="conn-stat-label">Remote IPs</span><span className="conn-stat-value">{latest.unique_remote_ips ?? '—'}</span></div>
          <div className="conn-stat"><span className="conn-stat-label">Interface</span><span className="conn-stat-value" style={{ fontSize: 14 }}>{latest.interface_speed_mbps ?? '—'} Mbps</span></div>
        </div>
        <div style={{ padding: '0 24px 20px' }}>
          <div className="section-title" style={{ marginBottom: 8 }}>
            Listening Ports
            {newPorts.length > 0 && <span style={{ marginLeft: 8, fontSize: 11, color: '#ffb347' }}>{newPorts.length} new ↑</span>}
          </div>
          <div className="chip-row">
            {[...currentPorts].sort((a, b) => a - b).map(port => (
              <PortTag key={port} port={port} isNew={newPorts.includes(port)} />
            ))}
          </div>
        </div>
        {(latest.suspicious_port_access > 0 || latest.potential_port_scan > 0) && (
          <div style={{ padding: '0 24px 20px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {latest.suspicious_port_access > 0 && (
              <div style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,71,87,0.15)', border: '1px solid rgba(255,71,87,0.3)', fontSize: 13 }}>
                🚨 Suspicious port access: <strong style={{ color: '#ff4757' }}>{latest.suspicious_port_access}</strong>
              </div>
            )}
            {latest.potential_port_scan > 0 && (
              <div style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,71,87,0.15)', border: '1px solid rgba(255,71,87,0.3)', fontSize: 13 }}>
                🔍 Potential port scan: <strong style={{ color: '#ff4757' }}>{latest.potential_port_scan}</strong> port(s)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — routes between card grid and detail view
// ═══════════════════════════════════════════════════════════════════════════════

export default function PCDetail({ summaries, timeRange, onTimeRange }) {
  const { pcId } = useParams()

  // If a pcId is in the URL → show full detail view
  // If no pcId (/pc) → show card grid
  if (pcId) {
    return <PCDetailView timeRange={timeRange} onTimeRange={onTimeRange} />
  }
  return <PCCardGrid summaries={summaries} />
}
