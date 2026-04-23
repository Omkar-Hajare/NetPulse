import { Routes, Route } from 'react-router-dom'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Sidebar from './components/Sidebar.jsx'
import Header from './components/Header.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Overview from './pages/Overview.jsx'
import PCDetail from './pages/PCDetail.jsx'
import Security from './pages/Security.jsx'
import {
  fetchSummaries, fetchOverview, fetchAlerts,
  fetchHealth, fetchStats, fetchPCsStatus,
  generateDemoSummaries, generateDemoOverview, generateDemoAlerts,
} from './api.js'
import { useAuthState } from './hooks/useAuthState.js'

import Landing from './pages/Landing.jsx'

// ─── Stable Dashboard Layout (defined OUTSIDE App to keep identity stable) ───
function DashboardLayout({
  displayName, pcList, selectedPC, setSelectedPC,
  timeRange, setTimeRange, lastUpdate, loadData, isConnected,
  summaries, overviewKPIs, alertsData, fleetStats, pcStatuses,
}) {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-wrapper">
        <Header
          user={displayName}
          pcList={pcList}
          selectedPC={selectedPC}
          onSelectPC={setSelectedPC}
          timeRange={timeRange}
          onTimeRange={setTimeRange}
          lastUpdate={lastUpdate}
          onRefresh={loadData}
          isConnected={isConnected}
        />
        <div className="main-content">
          <Routes>
            <Route path="/" element={
              <Overview
                summaries={summaries}
                overviewKPIs={overviewKPIs}
                fleetStats={fleetStats}
                pcStatuses={pcStatuses}
                timeRange={timeRange}
                selectedPC={selectedPC}
              />
            } />
            <Route path="pc" element={
              <PCDetail summaries={summaries || []} timeRange={timeRange} onTimeRange={setTimeRange} />
            } />
            <Route path="pc/:pcId" element={
              <PCDetail summaries={summaries || []} timeRange={timeRange} onTimeRange={setTimeRange} />
            } />
            <Route path="security" element={
              <Security alertsData={alertsData} summaries={summaries} timeRange={timeRange} />
            } />
            <Route path="alerts" element={
              <Security alertsData={alertsData} summaries={summaries} timeRange={timeRange} alertsOnly />
            } />
          </Routes>
        </div>
      </div>
    </div>
  )
}

// ─── Shallow-compare helper: merge new summaries without replacing unchanged ones ───
function mergeSummaries(prev, next) {
  if (!prev || prev.length !== next.length) return next
  // Build a map for O(1) lookup
  const nextMap = new Map(next.map(s => [s.pc_id, s]))
  let changed = false
  const merged = prev.map(old => {
    const updated = nextMap.get(old.pc_id)
    if (!updated) { changed = true; return old }
    // Check if any values actually changed
    const keys = Object.keys(updated)
    const same = keys.every(k => old[k] === updated[k])
    if (!same) { changed = true; return updated }
    return old // keep same reference — prevents child re-render
  })
  // If there are new PCs not in prev, we need to include them
  if (nextMap.size !== prev.length) changed = true
  return changed ? (nextMap.size !== prev.length ? next : merged) : prev
}

export default function App() {
  const { user: firebaseUser } = useAuthState()
  const [summaries, setSummaries] = useState(null)
  const [overviewKPIs, setOverviewKPIs] = useState(null)
  const [alertsData, setAlertsData] = useState(null)
  const [fleetStats, setFleetStats] = useState(null)
  const [pcStatuses, setPcStatuses] = useState(null)
  const [timeRange, setTimeRange] = useState('1h')
  const [selectedPC, setSelectedPC] = useState('all')
  const [lastUpdate, setLastUpdate] = useState(null)
  const [isConnected, setIsConnected] = useState(true)
  const isFirstLoad = useRef(true)

  const displayName = firebaseUser?.displayName
    || firebaseUser?.email?.split('@')[0]
    || 'User'

  const loadData = useCallback(async () => {
    const sumRes = await fetchSummaries()
    if (sumRes?.summaries) {
      setSummaries(prev => mergeSummaries(prev, sumRes.summaries))
      setIsConnected(true)
    } else if (isFirstLoad.current) {
      // Only generate demo data on first load, not on every failed poll
      const demo = generateDemoSummaries()
      setSummaries(demo.summaries)
      setIsConnected(false)
    }

    const ovRes = await fetchOverview()
    if (ovRes) {
      setOverviewKPIs(prev => {
        if (!prev) return ovRes
        // Only update if values actually changed
        const keys = Object.keys(ovRes)
        const same = keys.every(k => prev[k] === ovRes[k])
        return same ? prev : ovRes
      })
    } else if (isFirstLoad.current) {
      setSummaries(curr => {
        if (curr) setOverviewKPIs(generateDemoOverview(curr))
        return curr
      })
    }

    const alRes = await fetchAlerts({ limit: 50 })
    if (alRes) {
      setAlertsData(alRes)
    } else if (isFirstLoad.current) {
      setAlertsData(generateDemoAlerts())
    }

    // ── Newly wired: fleet stats, PC online/offline status, health ──
    const statsRes = await fetchStats(timeRange)
    if (statsRes) setFleetStats(statsRes)

    const statusRes = await fetchPCsStatus()
    if (statusRes?.pcs) setPcStatuses(statusRes.pcs)

    // Health check drives the isConnected indicator
    const healthRes = await fetchHealth()
    if (healthRes?.status === 'ok') {
      setIsConnected(true)
    }

    setLastUpdate(new Date())
    isFirstLoad.current = false
  }, [timeRange])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 60_000)
    return () => clearInterval(interval)
  }, [loadData])

  const pcList = useMemo(() => summaries?.map(s => s.pc_id) || [], [summaries])

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/dashboard/*" element={
        <ProtectedRoute>
          <DashboardLayout
            displayName={displayName}
            pcList={pcList}
            selectedPC={selectedPC}
            setSelectedPC={setSelectedPC}
            timeRange={timeRange}
            setTimeRange={setTimeRange}
            lastUpdate={lastUpdate}
            loadData={loadData}
            isConnected={isConnected}
            summaries={summaries}
            overviewKPIs={overviewKPIs}
            fleetStats={fleetStats}
            pcStatuses={pcStatuses}
            alertsData={alertsData}
          />
        </ProtectedRoute>
      } />
    </Routes>
  )
}

