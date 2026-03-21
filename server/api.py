"""
NetPulse — FastAPI REST API Server
Serves network monitoring data from MongoDB to the dashboard frontend.
"""

import os
import time
import math
import random
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient, DESCENDING
from pymongo.errors import ServerSelectionTimeoutError

# ─── Configuration ────────────────────────────────────────────────────────────

MONGO_URI           = os.getenv("MONGO_URI",           "mongodb://localhost:27017/")
MONGO_DB            = os.getenv("MONGO_DB",            "netpulse")
LOGS_COLLECTION     = os.getenv("LOGS_COLLECTION",     "network_logs")
ALERTS_COLLECTION   = os.getenv("ALERTS_COLLECTION",   "alerts")
SUMMARY_COLLECTION  = os.getenv("SUMMARY_COLLECTION",  "summaries")

# ─── App Setup ────────────────────────────────────────────────────────────────

app = FastAPI(title="NetPulse API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── MongoDB Connection (lazy — won't crash if Mongo is down at startup) ──────

_client = None
_db     = None

def get_db():
    """Return database handle, connecting lazily on first call."""
    global _client, _db
    if _client is None:
        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
        _db     = _client[MONGO_DB]
    return _db


def get_collection(name: str):
    return get_db()[name]


def serialize_doc(doc):
    """Convert MongoDB document to JSON-serializable dict."""
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc


def get_range_seconds(range_str: str) -> int:
    mapping = {"1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800}
    return mapping.get(range_str, 3600)


# ─── Real data check (cached for 5s to avoid per-request DB pings) ────────────

_real_data_cache = {"value": None, "checked_at": 0}

def has_real_data() -> bool:
    """Check if MongoDB has real data. Result cached for 5 seconds."""
    now = time.time()
    if now - _real_data_cache["checked_at"] < 5:
        return _real_data_cache["value"]
    try:
        result = get_collection(LOGS_COLLECTION).count_documents({}, limit=1) > 0
        _real_data_cache["value"]      = result
        _real_data_cache["checked_at"] = now
        return result
    except Exception:
        _real_data_cache["value"]      = False
        _real_data_cache["checked_at"] = now
        return False


# ─── Demo / Fallback Data ─────────────────────────────────────────────────────

_demo_cache = None

def get_demo_data():
    global _demo_cache
    if _demo_cache is None:
        _demo_cache = _generate_demo_data()
    return _demo_cache


def _generate_demo_data():
    now = time.time()
    pcs = [
        "LAB-PC-01", "LAB-PC-02", "LAB-PC-03",
        "OFFICE-PC-01", "OFFICE-PC-02",
        "SERVER-01", "SERVER-02",
        "DEV-PC-01", "DEV-PC-02",
    ]
    speeds = [1000, 1000, 100, 1000, 100, 10000, 10000, 1000, 1000]
    docs   = []

    for i, pc_id in enumerate(pcs):
        base_cpu = 20 + (i * 5) % 60
        base_mem = 40 + (i * 7) % 50

        for j in range(60):
            ts      = now - (59 - j) * 60
            cpu_val = round(max(0, min(100, base_cpu + 10 * math.sin(j / 5) + random.uniform(-5, 5))), 1)
            mem_val = round(max(0, min(100, base_mem + 5  * math.cos(j / 8) + random.uniform(-3, 3))), 1)
            tcp     = random.randint(5, 50)
            udp     = random.randint(2, 20)
            ports   = sorted(random.sample([22, 80, 443, 3000, 3306, 5173, 8080, 8443, 27017], random.randint(3, 7)))

            doc = {
                "pc_id":              pc_id,
                "timestamp":          ts,
                "cpu_usage":          cpu_val,
                "memory_usage":       mem_val,
                "disk_usage":         round(40 + (i * 11) % 50 + random.uniform(-2, 2), 1),
                "uptime_seconds":     86400 * (1 + i % 5) + j * 60,
                "bytes_sent":         random.randint(50_000,   5_000_000),
                "bytes_received":     random.randint(100_000,  8_000_000),
                "packets_sent":       random.randint(100,  5000),
                "packets_received":   random.randint(200,  8000),
                "interface_speed_mbps": speeds[i],
                "tcp_count":          tcp,
                "udp_count":          udp,
                "total_connections":  tcp + udp,
                "unique_remote_ips":  random.randint(3, 30),
                "listening_ports":    ports,
                "listening_port_count": len(ports),
                "suspicious_port_access": random.choice([0, 0, 0, 0, 0, 1]),
                "potential_port_scan":    random.choice([0, 0, 0, 0, 0, 0, 1]),
                "total_processes":    random.randint(80, 250),
                # FIX: field names match real agent schema (cpu not cpu%)
                "top_processes": [
                    {"name": "chrome.exe",  "cpu": round(random.uniform(2,  15), 1), "memory": round(random.uniform(5,  20), 1)},
                    {"name": "python.exe",  "cpu": round(random.uniform(1,  10), 1), "memory": round(random.uniform(3,  12), 1)},
                    {"name": "vscode.exe",  "cpu": round(random.uniform(0.5, 8), 1), "memory": round(random.uniform(4,  15), 1)},
                ],
                "firewall": {
                    "blocked_count": random.randint(0, 30),
                    "allowed_count": random.randint(50, 500),
                    # FIX: use realistic public IPs, not private 192.168 addresses
                    "blocked_ips":   [f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"
                                      for _ in range(random.randint(0, 3))],
                    "blocked_ports": random.sample([21, 22, 23, 445, 1900, 5353, 3389], random.randint(0, 3)),
                    "top_blocked_ip": None,
                },
            }
            if doc["firewall"]["blocked_ips"]:
                doc["firewall"]["top_blocked_ip"] = doc["firewall"]["blocked_ips"][0]
            docs.append(doc)

    return docs


# ─── Helper: build summary from latest log docs ───────────────────────────────

def _build_summary_from_logs(docs: list) -> list:
    """
    Build summary objects from raw log docs when the summaries collection
    is empty (analyser.py hasn't run yet).
    """
    latest_map = {}
    for d in docs:
        pc = d["pc_id"]
        if pc not in latest_map or d["timestamp"] > latest_map[pc]["timestamp"]:
            latest_map[pc] = d

    summaries = []
    for pc_id, doc in latest_map.items():
        summaries.append({
            "pc_id":           pc_id,
            "last_seen":       doc["timestamp"],
            "uptime_seconds":  doc.get("uptime_seconds", 0),
            "latest_cpu":      doc.get("cpu_usage", 0),
            "latest_memory":   doc.get("memory_usage", 0),
            "latest_disk":     doc.get("disk_usage", 0),
            "latest_connections": doc.get("total_connections", 0),
            "latest_bytes_rx": doc.get("bytes_received", 0),
            "latest_bytes_tx": doc.get("bytes_sent", 0),
            "listening_ports": doc.get("listening_ports", []),
            "listening_port_count": doc.get("listening_port_count", 0),
            "top_processes":   doc.get("top_processes", []),
            "fw_top_blocked_ip": doc.get("firewall", {}).get("top_blocked_ip"),
            "fw_blocked_total":  doc.get("firewall", {}).get("blocked_count", 0),
            # Defaults — analyser.py fills these when running
            "avg_cpu":        doc.get("cpu_usage", 0),
            "avg_memory":     doc.get("memory_usage", 0),
            "risk_score":     None,
            "anomaly_score":  None,
            "is_anomaly":     False,
            "samples_analysed": 1,
        })
    return summaries


# ─── API Endpoints ────────────────────────────────────────────────────────────

@app.get("/api/pcs")
def list_pcs():
    """List all monitored PC IDs."""
    if has_real_data():
        pc_ids = get_collection(LOGS_COLLECTION).distinct("pc_id")
    else:
        pc_ids = list(set(d["pc_id"] for d in get_demo_data()))
    return {"pcs": sorted(pc_ids)}


@app.get("/api/summaries")
def get_summaries():
    """
    Get one summary document per PC for the Overview page.
    Reads from summaries collection if analyser.py has populated it,
    otherwise falls back to computing summaries from raw logs.
    """
    if has_real_data():
        # Prefer analyser-computed summaries (fast single-doc reads)
        summaries = list(get_collection(SUMMARY_COLLECTION).find({}))
        summaries = [serialize_doc(s) for s in summaries]

        # If analyser hasn't run yet, build summaries from raw logs
        if not summaries:
            pipeline = [
                {"$sort":  {"timestamp": -1}},
                {"$group": {"_id": "$pc_id", "latest": {"$first": "$$ROOT"}}},
                {"$replaceRoot": {"newRoot": "$latest"}},
            ]
            docs      = [serialize_doc(d) for d in get_collection(LOGS_COLLECTION).aggregate(pipeline)]
            summaries = _build_summary_from_logs(docs)
    else:
        summaries = _build_summary_from_logs(get_demo_data())

    return {"summaries": sorted(summaries, key=lambda x: x.get("pc_id", ""))}


@app.get("/api/overview")
def get_overview():
    """
    Fleet-wide aggregated stats for the top KPI bar.
    Derived from summaries for speed.
    """
    result    = get_summaries()
    summaries = result["summaries"]

    if not summaries:
        return {"total_pcs": 0, "avg_cpu": 0, "avg_memory": 0,
                "total_connections": 0, "total_alerts": 0, "online_pcs": 0}

    n             = len(summaries)
    now           = time.time()
    online_cutoff = now - 180   # PC is "online" if seen in last 3 minutes

    avg_cpu    = round(sum(s.get("latest_cpu",    0) for s in summaries) / n, 1)
    avg_memory = round(sum(s.get("latest_memory", 0) for s in summaries) / n, 1)
    total_conn = sum(s.get("latest_connections", 0) for s in summaries)
    online_pcs = sum(1 for s in summaries if s.get("last_seen", 0) >= online_cutoff)

    # Total alerts from alerts collection
    total_alerts = 0
    if has_real_data():
        try:
            total_alerts = get_collection(ALERTS_COLLECTION).count_documents({"resolved": False})
        except Exception:
            pass

    return {
        "total_pcs":        n,
        "online_pcs":       online_pcs,
        "avg_cpu":          avg_cpu,
        "avg_memory":       avg_memory,
        "total_connections": total_conn,
        "total_alerts":     total_alerts,
    }


@app.get("/api/pcs/{pc_id}/latest")
def get_pc_latest(pc_id: str):
    """Get the latest snapshot for a specific PC."""
    if has_real_data():
        doc = get_collection(LOGS_COLLECTION).find_one(
            {"pc_id": pc_id}, sort=[("timestamp", DESCENDING)]
        )
        if not doc:
            raise HTTPException(status_code=404, detail=f"PC '{pc_id}' not found")
        return serialize_doc(doc)
    else:
        demos = sorted(
            [d for d in get_demo_data() if d["pc_id"] == pc_id],
            key=lambda x: x["timestamp"], reverse=True
        )
        if not demos:
            raise HTTPException(status_code=404, detail=f"PC '{pc_id}' not found")
        return demos[0]


@app.get("/api/pcs/{pc_id}/history")
def get_pc_history(
    pc_id: str,
    range: str = Query("1h", regex="^(1h|6h|24h|7d)$"),
    limit: int = Query(100, ge=1, le=500),
):
    """Get time-series data for a PC within a time range."""
    cutoff = time.time() - get_range_seconds(range)

    if has_real_data():
        cursor = get_collection(LOGS_COLLECTION).find(
            {"pc_id": pc_id, "timestamp": {"$gte": cutoff}},
            sort=[("timestamp", 1)],
            limit=limit,
        )
        docs = [serialize_doc(d) for d in cursor]
    else:
        docs = sorted(
            [d for d in get_demo_data() if d["pc_id"] == pc_id and d["timestamp"] >= cutoff],
            key=lambda x: x["timestamp"]
        )[:limit]

    if not docs:
        raise HTTPException(status_code=404, detail=f"No data for PC '{pc_id}' in range '{range}'")
    return {"pc_id": pc_id, "range": range, "count": len(docs), "data": docs}


@app.get("/api/alerts")
def get_alerts(
    limit:    int            = Query(50,  ge=1,  le=200),
    severity: Optional[str]  = Query(None, regex="^(critical|warning|info)$"),
    category: Optional[str]  = Query(None),
    pc_id:    Optional[str]  = Query(None),
    resolved: bool           = Query(False),
):
    """
    Get alerts from the dedicated alerts collection (written by analyser.py).
    Falls back to deriving alerts from raw logs if alerts collection is empty.
    """
    if has_real_data():
        # Try dedicated alerts collection first
        query: dict = {"resolved": resolved}
        if severity:
            query["severity"] = severity
        if category:
            query["category"] = category
        if pc_id:
            query["pc_id"] = pc_id

        alert_docs = list(
            get_collection(ALERTS_COLLECTION)
            .find(query)
            .sort("timestamp", DESCENDING)
            .limit(limit)
        )

        if alert_docs:
            return {
                "alerts": [serialize_doc(a) for a in alert_docs],
                "total":  get_collection(ALERTS_COLLECTION).count_documents(query),
            }

        # Fallback: derive from raw logs if analyser hasn't run yet
        raw_query = {"$or": [
            {"suspicious_port_access": {"$gt": 0}},
            {"potential_port_scan":    {"$gt": 0}},
            {"firewall.blocked_count": {"$gt": 50}},   # only high blocks
        ]}
        if pc_id:
            raw_query["pc_id"] = pc_id

        raw_docs = list(
            get_collection(LOGS_COLLECTION)
            .find(raw_query)
            .sort("timestamp", DESCENDING)
            .limit(limit)
        )
        return {"alerts": _derive_alerts(raw_docs, limit), "total": len(raw_docs)}

    else:
        raw_docs = [
            d for d in get_demo_data()
            if d.get("suspicious_port_access", 0) > 0
            or d.get("potential_port_scan", 0) > 0
            or d.get("firewall", {}).get("blocked_count", 0) > 10
        ]
        return {"alerts": _derive_alerts(raw_docs, limit), "total": len(raw_docs)}


def _derive_alerts(docs: list, limit: int) -> list:
    """Build structured alert objects from raw log documents."""
    alerts = []
    for d in docs:
        if d.get("suspicious_port_access", 0) > 0:
            alerts.append({
                "pc_id":     d["pc_id"],
                "timestamp": d["timestamp"],
                "severity":  "critical",
                "category":  "security",
                "message":   f"Suspicious port access: {d['suspicious_port_access']} connection(s)",
                "value":     d["suspicious_port_access"],
                "resolved":  False,
            })
        if d.get("potential_port_scan", 0) > 0:
            alerts.append({
                "pc_id":     d["pc_id"],
                "timestamp": d["timestamp"],
                "severity":  "critical",
                "category":  "security",
                "message":   f"Potential port scan on {d['potential_port_scan']} local port(s)",
                "value":     d["potential_port_scan"],
                "resolved":  False,
            })
        fw = d.get("firewall", {})
        blocked = fw.get("blocked_count", 0)
        if blocked > 50:
            alerts.append({
                "pc_id":     d["pc_id"],
                "timestamp": d["timestamp"],
                "severity":  "warning",
                "category":  "firewall",
                "message":   f"High firewall block rate: {blocked} blocks. Top IP: {fw.get('top_blocked_ip', 'unknown')}",
                "value":     blocked,
                "resolved":  False,
            })

    alerts.sort(key=lambda x: x["timestamp"], reverse=True)
    return alerts[:limit]


@app.patch("/api/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: str):
    """Mark an alert as resolved."""
    if not has_real_data():
        return {"ok": True, "message": "Demo mode — no persistence"}
    from bson import ObjectId
    try:
        result = get_collection(ALERTS_COLLECTION).update_one(
            {"_id": ObjectId(alert_id)},
            {"$set": {"resolved": True}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Alert not found")
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/security/threat-ips")
def get_threat_ips(limit: int = Query(20, ge=1, le=100)):
    """
    Aggregate blocked IPs across all PCs.
    Returns each IP with count, affected PCs, and blocked ports.
    """
    cutoff = time.time() - 86400   # last 24 hours

    if has_real_data():
        pipeline = [
            {"$match": {"timestamp": {"$gte": cutoff}, "firewall.blocked_ips": {"$exists": True, "$ne": []}}},
            {"$unwind": "$firewall.blocked_ips"},
            {"$group": {
                "_id":   "$firewall.blocked_ips",
                "count": {"$sum": 1},
                "pcs":   {"$addToSet": "$pc_id"},
            }},
            {"$sort":  {"count": -1}},
            {"$limit": limit},
        ]
        results = list(get_collection(LOGS_COLLECTION).aggregate(pipeline))
        threat_ips = [{"ip": r["_id"], "count": r["count"], "pcs": r["pcs"]} for r in results]
    else:
        ip_map: dict = {}
        for d in get_demo_data():
            for ip in d.get("firewall", {}).get("blocked_ips", []):
                if ip not in ip_map:
                    ip_map[ip] = {"count": 0, "pcs": set()}
                ip_map[ip]["count"] += 1
                ip_map[ip]["pcs"].add(d["pc_id"])
        threat_ips = sorted(
            [{"ip": ip, "count": v["count"], "pcs": list(v["pcs"])} for ip, v in ip_map.items()],
            key=lambda x: x["count"], reverse=True
        )[:limit]

    return {"threat_ips": threat_ips, "total": len(threat_ips)}


@app.get("/api/stats")
def get_global_stats(range: str = Query("1h", regex="^(1h|6h|24h|7d)$")):
    """Global aggregated statistics over a time range."""
    cutoff = time.time() - get_range_seconds(range)

    if has_real_data():
        pipeline = [
            {"$match": {"timestamp": {"$gte": cutoff}}},
            {"$group": {
                "_id":               None,
                "avg_cpu":           {"$avg": "$cpu_usage"},
                "avg_mem":           {"$avg": "$memory_usage"},
                "avg_disk":          {"$avg": "$disk_usage"},
                "total_bytes_sent":  {"$sum": "$bytes_sent"},
                "total_bytes_recv":  {"$sum": "$bytes_received"},
                "total_alerts":      {"$sum": "$suspicious_port_access"},
                "total_blocked":     {"$sum": "$firewall.blocked_count"},
                "doc_count":         {"$sum": 1},
            }},
        ]
        result = list(get_collection(LOGS_COLLECTION).aggregate(pipeline))
        if result:
            r = result[0]
            del r["_id"]
            r["avg_cpu"]  = round(r["avg_cpu"]  or 0, 1)
            r["avg_mem"]  = round(r["avg_mem"]  or 0, 1)
            r["avg_disk"] = round(r["avg_disk"] or 0, 1)
            return r
    else:
        docs = [d for d in get_demo_data() if d["timestamp"] >= cutoff]
        if docs:
            return {
                "avg_cpu":          round(sum(d["cpu_usage"]      for d in docs) / len(docs), 1),
                "avg_mem":          round(sum(d["memory_usage"]   for d in docs) / len(docs), 1),
                "avg_disk":         round(sum(d["disk_usage"]     for d in docs) / len(docs), 1),
                "total_bytes_sent": sum(d["bytes_sent"]           for d in docs),
                "total_bytes_recv": sum(d["bytes_received"]       for d in docs),
                "total_alerts":     sum(d.get("suspicious_port_access", 0) for d in docs),
                "total_blocked":    sum(d.get("firewall", {}).get("blocked_count", 0) for d in docs),
                "doc_count":        len(docs),
            }

    return {"avg_cpu": 0, "avg_mem": 0, "avg_disk": 0, "total_bytes_sent": 0,
            "total_bytes_recv": 0, "total_alerts": 0, "total_blocked": 0, "doc_count": 0}


# ─── Fleet-wide history (aggregated across all PCs) ───────────────────────────

@app.get("/api/fleet/history")
def get_fleet_history(
    range: str = Query("1h", regex="^(1h|6h|24h|7d)$"),
    limit: int = Query(100, ge=1, le=500),
):
    """
    Aggregated time-series data across ALL PCs — used for the Overview chart
    when 'All PCs' is selected. Returns averaged metrics bucketed by timestamp.
    """
    cutoff = time.time() - get_range_seconds(range)

    if has_real_data():
        # Determine a sensible bucket interval based on time range
        range_sec = get_range_seconds(range)
        bucket_secs = max(60, range_sec // limit)  # at least 60s buckets

        pipeline = [
            {"$match": {"timestamp": {"$gte": cutoff}}},
            {"$group": {
                "_id": {
                    "$subtract": [
                        "$timestamp",
                        {"$mod": ["$timestamp", bucket_secs]},
                    ]
                },
                "cpu_usage":       {"$avg": "$cpu_usage"},
                "memory_usage":    {"$avg": "$memory_usage"},
                "disk_usage":      {"$avg": "$disk_usage"},
                "bytes_sent":      {"$avg": "$bytes_sent"},
                "bytes_received":  {"$avg": "$bytes_received"},
                "packets_sent":    {"$avg": "$packets_sent"},
                "packets_received": {"$avg": "$packets_received"},
                "total_connections": {"$avg": "$total_connections"},
                "total_processes":  {"$avg": "$total_processes"},
                "unique_remote_ips": {"$avg": "$unique_remote_ips"},
                "pc_count":        {"$addToSet": "$pc_id"},
            }},
            {"$sort": {"_id": 1}},
            {"$limit": limit},
        ]
        results = list(get_collection(LOGS_COLLECTION).aggregate(pipeline))
        docs = []
        for r in results:
            docs.append({
                "timestamp":        r["_id"],
                "cpu_usage":        round(r["cpu_usage"] or 0, 1),
                "memory_usage":     round(r["memory_usage"] or 0, 1),
                "disk_usage":       round(r.get("disk_usage") or 0, 1),
                "bytes_sent":       int(r["bytes_sent"] or 0),
                "bytes_received":   int(r["bytes_received"] or 0),
                "packets_sent":     int(r.get("packets_sent") or 0),
                "packets_received": int(r.get("packets_received") or 0),
                "total_connections": int(r.get("total_connections") or 0),
                "total_processes":  int(r.get("total_processes") or 0),
                "unique_remote_ips": int(r.get("unique_remote_ips") or 0),
                "pc_count":         len(r.get("pc_count", [])),
                "pc_id":            "fleet-avg",
            })
        return {"pc_id": "fleet-avg", "range": range, "count": len(docs), "data": docs}
    else:
        # Demo mode — aggregate demo data across PCs
        all_docs = [d for d in get_demo_data() if d["timestamp"] >= cutoff]
        if not all_docs:
            return {"pc_id": "fleet-avg", "range": range, "count": 0, "data": []}

        # Group by bucketed timestamp
        range_sec = get_range_seconds(range)
        bucket_secs = max(60, range_sec // limit)
        buckets: dict = {}
        for d in all_docs:
            key = int(d["timestamp"] // bucket_secs) * bucket_secs
            if key not in buckets:
                buckets[key] = []
            buckets[key].append(d)

        docs = []
        for ts in sorted(buckets.keys())[:limit]:
            group = buckets[ts]
            n = len(group)
            docs.append({
                "timestamp":        ts,
                "pc_id":            "fleet-avg",
                "cpu_usage":        round(sum(d["cpu_usage"] for d in group) / n, 1),
                "memory_usage":     round(sum(d["memory_usage"] for d in group) / n, 1),
                "disk_usage":       round(sum(d.get("disk_usage", 0) for d in group) / n, 1),
                "bytes_sent":       int(sum(d["bytes_sent"] for d in group) / n),
                "bytes_received":   int(sum(d["bytes_received"] for d in group) / n),
                "total_connections": int(sum(d.get("total_connections", 0) for d in group) / n),
                "total_processes":  int(sum(d.get("total_processes", 0) for d in group) / n),
                "pc_count":         len(set(d["pc_id"] for d in group)),
            })
        return {"pc_id": "fleet-avg", "range": range, "count": len(docs), "data": docs}


# ─── Health check ─────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    """Quick health check — confirms API and MongoDB connectivity."""
    mongo_ok = False
    try:
        get_db().command("ping")
        mongo_ok = True
    except Exception:
        pass
    return {
        "status":    "ok" if mongo_ok else "degraded",
        "mongo":     mongo_ok,
        "real_data": has_real_data(),
        "timestamp": time.time(),
    }


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)