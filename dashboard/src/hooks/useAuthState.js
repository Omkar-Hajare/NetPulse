import { useState, useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase'

/**
 * Custom hook that listens to Firebase auth state.
 * Returns { user, loading } — `user` is Firebase User object or null.
 *
 * This is the single source of truth for auth state across the app.
 * It persists across page refreshes (Firebase uses IndexedDB internally).
 */
export function useAuthState() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  return { user, loading }
}
