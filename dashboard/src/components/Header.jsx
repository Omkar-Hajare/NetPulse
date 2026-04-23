import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

export default function Header({
  user,
  pcList = [], selectedPC, onSelectPC,
  timeRange, onTimeRange,
  lastUpdate, onRefresh,
  isConnected = true,
}) {
  const navigate = useNavigate();
  const userName = user || 'User';
  const initial = userName.charAt(0).toUpperCase();

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.warn('Logout error:', err);
    }
    navigate('/');
  };

  return (
    <header className="header">
      <div className="header-left">
        <h2>Dashboard</h2>
        <div className="refresh-indicator">
          <span className={`refresh-dot ${isConnected ? 'live' : 'demo'}`}></span>
          <span className="refresh-label">
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
        >
          <option value="all">All PCs</option>
          {pcList.map(pc => (
            <option key={pc} value={pc}>{pc}</option>
          ))}
        </select>

        <select
          className="header-select"
          value={timeRange}
          onChange={e => onTimeRange(e.target.value)}
        >
          <option value="1h">Last 1 Hour</option>
          <option value="6h">Last 6 Hours</option>
          <option value="24h">Last 24 Hours</option>
          <option value="7d">Last 7 Days</option>
        </select>

        <button className="header-btn" onClick={onRefresh} title="Refresh now">
          ↻ Refresh
        </button>

        {/* User Profile & Logout */}
        <div className="header-user-section">
          <div className="header-user-info" title={userName}>
            <div className="header-avatar">
              {initial}
            </div>
            <span className="header-username">
              {userName.split('@')[0]}
            </span>
          </div>
          <button
            className="header-btn header-logout-btn"
            onClick={handleLogout}
            title="Log out"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  )
}

