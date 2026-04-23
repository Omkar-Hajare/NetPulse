import { Navigate } from 'react-router-dom'
import { useAuthState } from '../hooks/useAuthState'

/**
 * Route guard — redirects to landing page if user is not authenticated.
 * Shows nothing while Firebase is still checking auth state (avoids flash).
 */
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuthState()

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-primary)',
      }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
        }}>
          <div className="loading-spinner" />
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Verifying session…</span>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/" replace />
  }

  return children
}
