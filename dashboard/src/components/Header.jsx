import { useNavigate } from 'react-router-dom';

export default function Header({
  user,
  pcList = [], selectedPC, onSelectPC,
  timeRange, onTimeRange,
  lastUpdate, onRefresh,
  isConnected = true,
}) {
  const navigate = useNavigate();
  const userName = user || 'Admin';
  const initial = userName.charAt(0).toUpperCase();

  const handleLogout = () => {
    navigate('/');
  };

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

        {/* User Profile & Logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginLeft: '12px', paddingLeft: '16px', borderLeft: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} title={userName}>
            <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-cyan))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '13px', color: '#fff', boxShadow: '0 0 10px rgba(168, 85, 247, 0.3)' }}>
              {initial}
            </div>
            <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)', maxWidth: '120px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {userName.split('@')[0]}
            </span>
          </div>
          <button 
            className="header-btn" 
            onClick={handleLogout}
            title="Log out"
            style={{ color: 'var(--accent-red)', borderColor: 'rgba(255,71,87,0.2)' }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,71,87,0.1)'; e.currentTarget.style.borderColor = 'rgba(255,71,87,0.4)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,71,87,0.2)'; }}
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  )
}
