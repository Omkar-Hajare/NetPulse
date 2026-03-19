export default function Header({
  pcList = [], selectedPC, onSelectPC,
  timeRange, onTimeRange,
  lastUpdate, onRefresh,
  isConnected = true,
}) {
  return (
    <header className="header">
      <div className="header-left">
        <h2>Dashboard</h2>
        <div className="refresh-indicator">
          <span className={`refresh-dot ${isConnected ? 'live' : 'demo'}`}></span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {isConnected ? 'Live' : 'Demo mode'}
            {lastUpdate ? ` · ${lastUpdate.toLocaleTimeString()}` : ''}
          </span>
        </div>
      </div>

      <div className="header-right">
        <select
          className="header-select"
          value={selectedPC}
          onChange={e => onSelectPC(e.target.value)}
          style={{
            background: '#1a2535',
            color: '#e8e8f0',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 13,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="all" style={{ background: '#1a2535', color: '#e8e8f0' }}>All PCs</option>
          {pcList.map(pc => (
            <option key={pc} value={pc} style={{ background: '#1a2535', color: '#e8e8f0' }}>{pc}</option>
          ))}
        </select>

        <select
          className="header-select"
          value={timeRange}
          onChange={e => onTimeRange(e.target.value)}
          style={{
            background: '#1a2535',
            color: '#e8e8f0',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 13,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="1h" style={{ background: '#1a2535', color: '#e8e8f0' }}>Last 1 Hour</option>
          <option value="6h" style={{ background: '#1a2535', color: '#e8e8f0' }}>Last 6 Hours</option>
          <option value="24h" style={{ background: '#1a2535', color: '#e8e8f0' }}>Last 24 Hours</option>
          <option value="7d" style={{ background: '#1a2535', color: '#e8e8f0' }}>Last 7 Days</option>
        </select>

        <button className="header-btn" onClick={onRefresh} title="Refresh now">
          ↻ Refresh
        </button>
      </div>
    </header>
  )
}
