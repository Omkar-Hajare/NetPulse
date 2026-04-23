import { useNavigate } from 'react-router-dom'
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { fetchPCHistory, fetchFleetHistory, generateDemoHistory } from '../api.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTS(ts) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatBytes(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB'
  if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB'
  return b + ' B'
}

function formatUptime(sec) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  if (d > 0) return `${d}d ${h}h`
  return `${h}h ${Math.floor((sec % 3600) / 60)}m`
}

// Risk score → color
function riskColor(score) {
  if (score == null) return 'var(--text-muted)'
  if (score >= 70) return 'var(--accent-red)'
  if (score >= 30) return 'var(--accent-amber)'
  return 'var(--accent-green)'
}

// FIX: use latest_cpu/latest_memory from summary schema
function getStatus(summary) {
  const cpu = summary.latest_cpu || 0
  const mem = summary.latest_memory || 0
  if (summary.is_anomaly || cpu > 80 || mem > 90) return 'critical'
  if (cpu > 60 || mem > 75) return 'warning'
  return 'healthy'
}

const DONUT_COLORS = ['#00d4ff', '#00ff88']
const TOOLTIP_STYLE = {
  backgroundColor: '#0f1923',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  padding: '10px 14px',
  fontSize: 12,
  color: '#e8e8f0',
}

// ─── Component ────────────────────────────────────────────────────────────────

// FIX: prop is now `summaries` (array of summary docs) + `overviewKPIs` (fleet numbers)
export default function Overview({ summaries, overviewKPIs, fleetStats, pcStatuses, timeRange, selectedPC }) {
  const navigate = useNavigate()
  const [historyData, setHistoryData] = useState([])
  const [sortKey, setSortKey] = useState('pc_id')
  const [sortDir, setSortDir] = useState(1)
  const hasMounted = useRef(false)

  // Only apply entrance animation on first mount
  useEffect(() => {
    // Mark as mounted after the entrance animation completes (~400ms)
    const timer = setTimeout(() => { hasMounted.current = true }, 500)
    return () => clearTimeout(timer)
  }, [])

  const animClass = hasMounted.current ? 'smooth-update' : 'animate-in'

  // Load chart history — specific PC if selected, otherwise fleet-wide demo average
  useEffect(() => {
    async function loadHistory() {
      if (selectedPC !== 'all') {
        const res = await fetchPCHistory(selectedPC, timeRange)
        if (res?.data) { setHistoryData(res.data); return }
        setHistoryData(generateDemoHistory(selectedPC, timeRange).data)
      } else {
        // All PCs: fetch real fleet-wide aggregated data
        const res = await fetchFleetHistory(timeRange)
        if (res?.data) { setHistoryData(res.data); return }
        // Fallback to demo if API unreachable
        setHistoryData(generateDemoHistory('fleet-avg', timeRange).data)
      }
    }
    loadHistory()
  }, [selectedPC, timeRange])

  // Chart label: named PC or "Fleet Average" — never falls back to summaries[0]
  const chartLabel = selectedPC !== 'all' ? selectedPC : 'Fleet Average'

  const chartData = useMemo(() => historyData.map(d => ({
    time: formatTS(d.timestamp),
    cpu: d.cpu_usage,
    memory: d.memory_usage,
    bytesSent: d.bytes_sent,
    bytesRecv: d.bytes_received,
  })), [historyData])

  // TCP vs UDP donut — sum across all summaries
  const connectionDonut = useMemo(() => {
    if (!summaries?.length) return []
    const tcp = summaries.reduce((s, p) => s + (p.latest_connections || 0), 0)
    return [{ name: 'Connections', value: tcp }]
  }, [summaries])

  const handleSort = key => {
    if (sortKey === key) setSortDir(d => -d)
    else { setSortKey(key); setSortDir(1) }
  }

  // FIX: sort uses summary field names (latest_cpu not cpu_usage)
  const sortedSummaries = useMemo(() => {
    if (!summaries) return []
    const fieldMap = {
      'pc_id': 'pc_id',
      'cpu_usage': 'latest_cpu',
      'memory_usage': 'latest_memory',
      'disk_usage': 'latest_disk',
      'total_connections': 'latest_connections',
      'risk_score': 'risk_score',
    }
    const field = fieldMap[sortKey] || sortKey
    return [...summaries].sort((a, b) => {
      const av = a[field] ?? ''
      const bv = b[field] ?? ''
      if (typeof av === 'number') return (av - bv) * sortDir
      return String(av).localeCompare(String(bv)) * sortDir
    })
  }, [summaries, sortKey, sortDir])

  // Loading skeleton
  if (!summaries) {
    return (
      <div>
        <div className="kpi-grid">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="kpi-card loading-skeleton" style={{ height: 100 }} />
          ))}
        </div>
        <div className="chart-card loading-skeleton" style={{ height: 300 }} />
      </div>
    )
  }

  const kpis = overviewKPIs || {}

  return (
    <div>
      {/* ── KPI Cards ── */}
      <div className="kpi-grid">
        <div className={`kpi-card ${animClass}`}>
          <div className="kpi-icon">🖥️</div>
          <div className="kpi-label">Total PCs</div>
          <div className="kpi-value cyan">{kpis.total_pcs ?? summaries.length}</div>
          <div className="kpi-subtitle">{kpis.online_pcs ?? summaries.length} online</div>
        </div>
        <div className={`kpi-card ${animClass}`}>
          <div className="kpi-icon">⚡</div>
          <div className="kpi-label">Avg CPU</div>
          <div className="kpi-value"
            style={{ color: (kpis.avg_cpu || 0) > 80 ? 'var(--accent-red)' : (kpis.avg_cpu || 0) > 60 ? 'var(--accent-amber)' : 'inherit' }}>
            {kpis.avg_cpu ?? '—'}%
          </div>
          <div className="kpi-subtitle">Across all PCs</div>
        </div>
        <div className={`kpi-card ${animClass}`}>
          <div className="kpi-icon">💾</div>
          <div className="kpi-label">Avg Memory</div>
          <div className="kpi-value"
            style={{ color: (kpis.avg_memory || 0) > 90 ? 'var(--accent-red)' : (kpis.avg_memory || 0) > 80 ? 'var(--accent-amber)' : 'inherit' }}>
            {kpis.avg_memory ?? '—'}%
          </div>
          <div className="kpi-subtitle">Across all PCs</div>
        </div>
        <div className={`kpi-card ${animClass}`}>
          <div className="kpi-icon">🔗</div>
          <div className="kpi-label">Total Connections</div>
          <div className="kpi-value green">{(kpis.total_connections ?? 0).toLocaleString()}</div>
          <div className="kpi-subtitle">TCP + UDP active</div>
        </div>
        <div className={`kpi-card ${animClass} ${(kpis.total_alerts || 0) > 0 ? 'danger' : ''}`}>
          <div className="kpi-icon">🚨</div>
          <div className="kpi-label">Active Alerts</div>
          <div className={`kpi-value ${(kpis.total_alerts || 0) > 0 ? 'red' : 'green'}`}>
            {kpis.total_alerts ?? 0}
          </div>
          <div className="kpi-subtitle">{(kpis.total_alerts || 0) > 0 ? 'Requires attention' : 'All clear'}</div>
        </div>
      </div>

      {/* ── Fleet Stats Row (from fetchStats) ── */}
      {fleetStats && (
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 0 }}>
          <div className={`kpi-card ${animClass}`} style={{ padding: '14px 20px' }}>
            <div className="kpi-label" style={{ fontSize: 11 }}>📤 Total Bytes Sent</div>
            <div className="kpi-value cyan" style={{ fontSize: 18 }}>{formatBytes(fleetStats.total_bytes_sent ?? 0)}</div>
            <div className="kpi-subtitle">This {timeRange}</div>
          </div>
          <div className={`kpi-card ${animClass}`} style={{ padding: '14px 20px' }}>
            <div className="kpi-label" style={{ fontSize: 11 }}>📥 Total Bytes Recv</div>
            <div className="kpi-value green" style={{ fontSize: 18 }}>{formatBytes(fleetStats.total_bytes_recv ?? 0)}</div>
            <div className="kpi-subtitle">This {timeRange}</div>
          </div>
          <div className={`kpi-card ${animClass}`} style={{ padding: '14px 20px' }}>
            <div className="kpi-label" style={{ fontSize: 11 }}>🔥 Firewall Blocked</div>
            <div className={`kpi-value ${(fleetStats.total_blocked ?? 0) > 100 ? 'red' : ''}`} style={{ fontSize: 18 }}>
              {(fleetStats.total_blocked ?? 0).toLocaleString()}
            </div>
            <div className="kpi-subtitle">Events this {timeRange}</div>
          </div>
          <div className={`kpi-card ${animClass}`} style={{ padding: '14px 20px' }}>
            <div className="kpi-label" style={{ fontSize: 11 }}>🗄️ Data Points</div>
            <div className="kpi-value" style={{ fontSize: 18 }}>{(fleetStats.doc_count ?? 0).toLocaleString()}</div>
            <div className="kpi-subtitle">Log entries collected</div>
          </div>
        </div>
      )}

      {/* ── CPU & Memory Chart ── */}
      <div className={`chart-card ${animClass}`}>
        <div className="chart-header">
          <span className="chart-title">CPU & Memory — {chartLabel}</span>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData} isAnimationActive={!hasMounted.current}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="time" stroke="#555577" fontSize={11} tickLine={false} />
            <YAxis stroke="#555577" fontSize={11} tickLine={false} domain={[0, 100]} unit="%" />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <Line type="monotone" dataKey="cpu" name="CPU %" stroke="#00d4ff" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={!hasMounted.current} />
            <Line type="monotone" dataKey="memory" name="Memory %" stroke="#00ff88" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={!hasMounted.current} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Network + Connections Row ── */}
      <div className="chart-grid">
        <div className={`chart-card ${animClass}`}>
          <div className="chart-header">
            <span className="chart-title">Network Throughput</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} isAnimationActive={!hasMounted.current}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="time" stroke="#555577" fontSize={11} tickLine={false} />
              <YAxis stroke="#555577" fontSize={11} tickLine={false} tickFormatter={v => formatBytes(v)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => formatBytes(v)} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Area type="monotone" dataKey="bytesSent" name="Sent" stroke="#00d4ff" fill="rgba(0,212,255,0.15)" strokeWidth={2} isAnimationActive={!hasMounted.current} />
              <Area type="monotone" dataKey="bytesRecv" name="Received" stroke="#00ff88" fill="rgba(0,255,136,0.15)" strokeWidth={2} isAnimationActive={!hasMounted.current} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className={`chart-card ${animClass}`}>
          <div className="chart-header">
            <span className="chart-title">Fleet Connections</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 24px' }}>
            {summaries.slice(0, 6).map(s => (
              <div key={s.pc_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 90 }}>{s.pc_id}</span>
                <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min((s.latest_connections / 300) * 100, 100)}%`,
                    height: '100%',
                    background: '#00d4ff',
                    borderRadius: 4,
                    transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
                  }} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 30, textAlign: 'right' }}>
                  {s.latest_connections}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── PC Status Table ── */}
      <div className={`chart-card ${animClass}`}>
        <div className="chart-header">
          <span className="chart-title">PC Status</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sortedSummaries.length} devices</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                {[
                  ['pc_id', 'PC Name'],
                  ['cpu_usage', 'CPU %'],
                  ['memory_usage', 'Memory %'],
                  ['disk_usage', 'Disk %'],
                  ['total_connections', 'Connections'],
                  ['risk_score', 'Risk'],
                ].map(([key, label]) => (
                  <th key={key} onClick={() => handleSort(key)} style={{ cursor: 'pointer' }}>
                    {label} {sortKey === key ? (sortDir > 0 ? '↑' : '↓') : ''}
                  </th>
                ))}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedSummaries.map(s => {
                const status = getStatus(s)
                // Prefer real online/offline from API status endpoint
                const liveStatus = pcStatuses?.find(p => p.pc_id === s.pc_id)
                const isOnline = liveStatus ? liveStatus.status === 'online' : (Date.now() / 1000 - (s.last_seen || 0)) < 180
                return (
                  <tr key={s.pc_id} onClick={() => navigate(`/dashboard/pc/${encodeURIComponent(s.pc_id)}`)}
                    style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 600 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: isOnline ? '#00ff88' : '#ff4757', flexShrink: 0, boxShadow: isOnline ? '0 0 5px #00ff88' : 'none' }} />
                        {s.pc_id}
                      </span>
                    </td>
                    <td style={{ color: (s.latest_cpu || 0) > 80 ? 'var(--accent-red)' : 'inherit' }}>{s.latest_cpu}%</td>
                    <td style={{ color: (s.latest_memory || 0) > 90 ? 'var(--accent-red)' : 'inherit' }}>{s.latest_memory}%</td>
                    <td style={{ color: (s.latest_disk || 0) > 85 ? 'var(--accent-amber)' : 'inherit' }}>{s.latest_disk}%</td>
                    <td>{s.latest_connections}</td>
                    <td>
                      {s.risk_score != null
                        ? <span style={{ fontWeight: 700, color: riskColor(s.risk_score) }}>{s.risk_score}/100</span>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>
                      }
                    </td>
                    <td>
                      <span className={`status-badge ${status}`}>
                        <span className="status-dot" />
                        {status}
                        {s.is_anomaly ? ' ⚠' : ''}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
