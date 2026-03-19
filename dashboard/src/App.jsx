import { Routes, Route } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import Sidebar from './components/Sidebar.jsx'
import Header from './components/Header.jsx'
import Overview from './pages/Overview.jsx'
import PCDetail from './pages/PCDetail.jsx'
import Security from './pages/Security.jsx'
import {
  fetchSummaries, fetchOverview, fetchAlerts,
  generateDemoSummaries, generateDemoOverview, generateDemoAlerts,
} from './api.js'

export default function App() {
  const [summaries, setSummaries] = useState(null)   // per-PC summary docs
  const [overviewKPIs, setOverviewKPIs] = useState(null)   // fleet-wide KPI numbers
  const [alertsData, setAlertsData] = useState(null)
  const [timeRange, setTimeRange] = useState('1h')
  const [selectedPC, setSelectedPC] = useState('all')
  const [lastUpdate, setLastUpdate] = useState(null)
  const [isConnected, setIsConnected] = useState(true)

  const loadData = useCallback(async () => {
    // FIX: fetch summaries (fast per-PC docs) for the Overview page
    const sumRes = await fetchSummaries()
    if (sumRes?.summaries) {
      setSummaries(sumRes.summaries)
      setIsConnected(true)
    } else {
      // API unreachable — fall back to demo data
      const demo = generateDemoSummaries()
      setSummaries(demo.summaries)
      setIsConnected(false)
    }

    // Fleet-wide KPI bar (total PCs, avg cpu etc.)
    const ovRes = await fetchOverview()
    if (ovRes) {
      setOverviewKPIs(ovRes)
    } else if (summaries) {
      setOverviewKPIs(generateDemoOverview(summaries))
    }

    // Alerts feed
    const alRes = await fetchAlerts({ limit: 50 })
    setAlertsData(alRes || generateDemoAlerts())

    setLastUpdate(new Date())
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load + 60s polling (matches agent collection cycle)
  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 60_000)
    return () => clearInterval(interval)
  }, [loadData])

  // PC list derived from summaries
  const pcList = summaries?.map(s => s.pc_id) || []

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-wrapper">
        <Header
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
            {/* Fleet overview — uses summaries for PC cards */}
            <Route path="/" element={
              <Overview
                summaries={summaries}
                overviewKPIs={overviewKPIs}
                timeRange={timeRange}
                selectedPC={selectedPC}
              />
            } />

            {/* PC Detail — /pc shows card grid, /pc/:id shows full detail */}
            <Route path="/pc" element={
              <PCDetail summaries={summaries || []} timeRange={timeRange} onTimeRange={setTimeRange} />
            } />
            <Route path="/pc/:pcId" element={
              <PCDetail summaries={summaries || []} timeRange={timeRange} onTimeRange={setTimeRange} />
            } />

            {/* Security / firewall view */}
            <Route path="/security" element={
              <Security
                alertsData={alertsData}
                summaries={summaries}
                timeRange={timeRange}
              />
            } />

            {/* Alert feed */}
            <Route path="/alerts" element={
              <Security
                alertsData={alertsData}
                summaries={summaries}
                timeRange={timeRange}
                alertsOnly
              />
            } />
          </Routes>
        </div>
      </div>
    </div>
  )
}
