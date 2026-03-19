import { NavLink } from 'react-router-dom'

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-icon">⚡</div>
        <h1>NetPulse</h1>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon">📊</span>
          <span>Overview</span>
        </NavLink>

        <NavLink to="/pc" className={({ isActive }) =>
          `nav-item ${isActive || window.location.pathname.startsWith('/pc/') ? 'active' : ''}`
        }>
          <span className="nav-icon">🖥️</span>
          <span>PC Detail</span>
        </NavLink>

        <NavLink to="/security" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon">🛡️</span>
          <span>Security</span>
        </NavLink>

        <NavLink to="/alerts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon">🚨</span>
          <span>Alerts</span>
        </NavLink>
      </nav>

      <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-subtle)', marginTop: 'auto' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
          NetPulse v1.0
        </div>
      </div>
    </aside>
  )
}
