"""
NetPulse — ML Analyser Service

Background service that continuously scores new log entries using the trained
Isolation Forest model. Runs alongside the API server.

Responsibilities:
  1. Load the trained model (or auto-train if no model exists)
  2. Poll MongoDB for new logs every ANALYSE_INTERVAL seconds
  3. Score each log entry → anomaly_score + is_anomaly
  4. Write per-PC summaries to the 'summaries' collection
  5. Create alerts in the 'alerts' collection when anomalies are detected
  6. Periodically retrain the model (every 6 hours by default)

USAGE:
    python analyser.py                   # uses default settings
    ANALYSE_INTERVAL=30 python analyser.py  # check every 30 seconds
"""

import os
import sys
import time
import json
import signal
import logging
from datetime import datetime, timezone

import numpy as np
from pymongo import MongoClient, DESCENDING
from pymongo.errors import ServerSelectionTimeoutError

# ─── Configuration (imported from central config) ────────────────────────────

from config import (
    MONGO_URI, MONGO_DB,
    LOGS_COLLECTION  as LOGS_COL,
    ALERTS_COLLECTION as ALERTS_COL,
    SUMMARY_COLLECTION as SUMMARY_COL,
    ANALYSE_INTERVAL, RETRAIN_INTERVAL, CONTAMINATION, MODEL_DIR,
)

# Anomaly score thresholds (model scores are typically -0.5 to 0.5)
# We normalize to 0–100 for the dashboard
RISK_THRESHOLDS = {
    "critical": 75,  # score >= 75 → critical alert
    "warning":  50,  # score >= 50 → warning alert
}

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(os.getenv("LOG_FILE", "netpulse_analyser.log")),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("netpulse-analyser")

# ─── State ────────────────────────────────────────────────────────────────────

_running = True
_model = None
_scaler = None
_model_loaded_at = 0
_last_processed_ts = 0


def handle_signal(signum, _):
    global _running
    log.info(f"Signal {signum} received. Stopping analyser...")
    _running = False


signal.signal(signal.SIGINT, handle_signal)
signal.signal(signal.SIGTERM, handle_signal)


# ─── MongoDB ──────────────────────────────────────────────────────────────────

def connect_mongo():
    """Connect to MongoDB with retries."""
    for attempt in range(5):
        try:
            client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
            client.admin.command("ping")
            log.info(f"Connected to MongoDB at {MONGO_URI}")
            return client[MONGO_DB]
        except ServerSelectionTimeoutError:
            log.warning(f"MongoDB not reachable (attempt {attempt + 1}/5)")
            time.sleep(5)
    log.error("Could not connect to MongoDB. Exiting.")
    sys.exit(1)


# ─── Model loading / training ────────────────────────────────────────────────

def load_or_train_model(db):
    """Load existing model from disk, or train a new one if none exists."""
    global _model, _scaler, _model_loaded_at
    import joblib

    model_path = os.path.join(MODEL_DIR, "anomaly_model.pkl")
    scaler_path = os.path.join(MODEL_DIR, "scaler.pkl")

    if os.path.exists(model_path) and os.path.exists(scaler_path):
        log.info(f"Loading model from {model_path}")
        _model = joblib.load(model_path)
        _scaler = joblib.load(scaler_path)
        _model_loaded_at = time.time()

        # Load metadata if available
        meta_path = os.path.join(MODEL_DIR, "model_metadata.json")
        if os.path.exists(meta_path):
            with open(meta_path) as f:
                meta = json.load(f)
            log.info(
                f"Model trained at {meta.get('trained_at_iso', 'unknown')} "
                f"on {meta.get('total_samples', '?')} samples "
                f"from {meta.get('unique_pcs', '?')} PCs"
            )
        return True
    else:
        log.info("No trained model found. Attempting auto-training...")
        return auto_train(db)


def auto_train(db):
    """Train a new model from available MongoDB data."""
    global _model, _scaler, _model_loaded_at

    collection = db[LOGS_COL]
    count = collection.count_documents({})

    if count < 50:
        log.warning(
            f"Only {count} logs in MongoDB — need at least 50 for training. "
            "Falling back to rule-based detection until more data is collected."
        )
        return False

    log.info(f"Auto-training on {count} documents...")

    try:
        # Import training function from ml module
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "ml"))
        from train_model import train_model
        _model, _scaler, metadata = train_model(
            contamination=CONTAMINATION,
            output_dir=MODEL_DIR,
        )
        _model_loaded_at = time.time()
        log.info("Auto-training complete!")
        return True
    except Exception as e:
        log.error(f"Auto-training failed: {e}")
        return False


def retrain_if_needed(db):
    """Retrain the model periodically."""
    if _model_loaded_at and (time.time() - _model_loaded_at) > RETRAIN_INTERVAL:
        log.info("Scheduled retraining...")
        auto_train(db)


# ─── Feature extraction (shared with ml/train_model.py) ────────────────────────────

# Import feature columns from the canonical ML training module so they are
# always in sync. We build a single-doc adapter around the bulk extractor.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "ml"))
try:
    from train_model import FEATURE_COLUMNS, extract_features as _extract_features_bulk
    import pandas as pd

    def extract_features_single(doc: dict) -> list:
        """Extract feature vector from one log doc (delegates to train_model)."""
        df = _extract_features_bulk([doc])
        return df[FEATURE_COLUMNS].values[0].tolist()

except ImportError:
    # Fallback if ml/ module is not on the path — mirrors train_model feature logic
    FEATURE_COLUMNS = [
        "cpu_usage", "memory_usage", "disk_usage",
        "bytes_sent", "bytes_received", "bytes_ratio",
        "total_connections", "unique_remote_ips", "tcp_udp_ratio",
        "suspicious_port_access", "potential_port_scan",
        "fw_blocked_count", "listening_port_count",
    ]

    def extract_features_single(doc: dict) -> list:
        """Fallback feature extraction when train_model is unavailable."""
        fw = doc.get("firewall", {})
        tcp = doc.get("tcp_count", 0) or 0
        udp = doc.get("udp_count", 0) or 0
        bytes_sent = doc.get("bytes_sent", 0) or 0
        bytes_received = doc.get("bytes_received", 0) or 0
        return [
            doc.get("cpu_usage", 0) or 0,
            doc.get("memory_usage", 0) or 0,
            doc.get("disk_usage", 0) or 0,
            bytes_sent,
            bytes_received,
            round(bytes_sent / (bytes_received + 1), 4),
            doc.get("total_connections", 0) or 0,
            doc.get("unique_remote_ips", 0) or 0,
            round(tcp / (udp + 1), 4),
            doc.get("suspicious_port_access", 0) or 0,
            doc.get("potential_port_scan", 0) or 0,
            fw.get("blocked_count", 0) or 0,
            doc.get("listening_port_count", 0) or 0,
        ]


def score_to_risk(raw_score: float) -> int:
    """
    Convert Isolation Forest raw score to a 0–100 risk score.
    Raw scores are typically in [-0.5, 0.5] where lower = more anomalous.
    """
    # Isolation Forest: scores < 0 are anomalies, > 0 are normal
    # Map [-0.5, 0.5] → [100, 0] (inverted — lower raw = higher risk)
    risk = int(max(0, min(100, (0.5 - raw_score) * 100)))
    return risk


# ─── Rule-based fallback (when no ML model is available) ──────────────────────

def rule_based_score(doc: dict) -> tuple:
    """
    Simple rule-based anomaly scoring for when ML model isn't trained yet.
    Returns (risk_score: int, is_anomaly: bool)
    """
    score = 0

    # High CPU
    cpu = doc.get("cpu_usage", 0) or 0
    if cpu > 90:
        score += 30
    elif cpu > 75:
        score += 15

    # High memory
    mem = doc.get("memory_usage", 0) or 0
    if mem > 90:
        score += 20
    elif mem > 75:
        score += 10

    # Suspicious port access
    suspicious = doc.get("suspicious_port_access", 0) or 0
    score += min(suspicious * 20, 40)

    # Port scan
    port_scan = doc.get("potential_port_scan", 0) or 0
    score += min(port_scan * 25, 50)

    # High firewall blocks
    fw_blocked = doc.get("firewall", {}).get("blocked_count", 0) or 0
    if fw_blocked > 100:
        score += 25
    elif fw_blocked > 50:
        score += 15

    # Too many connections
    conns = doc.get("total_connections", 0) or 0
    if conns > 200:
        score += 20
    elif conns > 100:
        score += 10

    # Too many unique remote IPs
    remote_ips = doc.get("unique_remote_ips", 0) or 0
    if remote_ips > 50:
        score += 15

    risk = min(score, 100)
    is_anomaly = risk >= 50

    return risk, is_anomaly


# ─── Analysis loop ────────────────────────────────────────────────────────────

def analyse_new_logs(db):
    """Process new log entries and generate scores + alerts."""
    global _last_processed_ts

    logs_col = db[LOGS_COL]
    alerts_col = db[ALERTS_COL]
    summary_col = db[SUMMARY_COL]

    # Fetch logs newer than last processed timestamp
    query = {}
    if _last_processed_ts > 0:
        query = {"timestamp": {"$gt": _last_processed_ts}}

    new_logs = list(
        logs_col.find(query).sort("timestamp", 1).limit(500)
    )

    if not new_logs:
        return 0

    log.info(f"Processing {len(new_logs)} new log entries...")

    # Track per-PC data for summary updates
    pc_data = {}
    alerts_to_insert = []

    for doc in new_logs:
        pc_id = doc.get("pc_id", "unknown")
        timestamp = doc.get("timestamp", 0)

        # Score the log entry
        if _model and _scaler:
            # ML-based scoring
            features = extract_features_single(doc)
            features_scaled = _scaler.transform([features])
            raw_score = _model.score_samples(features_scaled)[0]
            prediction = _model.predict(features_scaled)[0]
            risk_score = score_to_risk(raw_score)
            is_anomaly = prediction == -1
        else:
            # Rule-based fallback
            risk_score, is_anomaly = rule_based_score(doc)

        # Track per-PC data
        if pc_id not in pc_data:
            pc_data[pc_id] = {
                "scores": [],
                "anomaly_count": 0,
                "latest_doc": None,
            }
        pc_data[pc_id]["scores"].append(risk_score)
        if is_anomaly:
            pc_data[pc_id]["anomaly_count"] += 1
        pc_data[pc_id]["latest_doc"] = doc

        # Generate alert for anomalies
        if is_anomaly and risk_score >= RISK_THRESHOLDS["warning"]:
            severity = "critical" if risk_score >= RISK_THRESHOLDS["critical"] else "warning"
            alert = {
                "pc_id": pc_id,
                "timestamp": timestamp,
                "severity": severity,
                "category": "anomaly",
                "message": f"ML anomaly detected — risk score: {risk_score}/100",
                "value": risk_score,
                "resolved": False,
                "details": {
                    "cpu_usage": doc.get("cpu_usage"),
                    "memory_usage": doc.get("memory_usage"),
                    "total_connections": doc.get("total_connections"),
                    "unique_remote_ips": doc.get("unique_remote_ips"),
                    "suspicious_port_access": doc.get("suspicious_port_access"),
                    "fw_blocked_count": doc.get("firewall", {}).get("blocked_count"),
                },
                "detection_method": "ml" if _model else "rule-based",
            }
            alerts_to_insert.append(alert)

        # Update last processed timestamp
        _last_processed_ts = max(_last_processed_ts, timestamp)

    # Batch-insert alerts
    if alerts_to_insert:
        alerts_col.insert_many(alerts_to_insert)
        log.info(f"Created {len(alerts_to_insert)} new alerts")

    # Update summaries
    for pc_id, data in pc_data.items():
        doc = data["latest_doc"]
        fw = doc.get("firewall", {})
        avg_score = int(np.mean(data["scores"]))

        # Compute actual averages across all processed logs for this PC
        all_docs = [d for d in new_logs if d.get("pc_id") == pc_id]
        avg_cpu = round(np.mean([d.get("cpu_usage", 0) for d in all_docs]), 1) if all_docs else doc.get("cpu_usage", 0)
        avg_mem = round(np.mean([d.get("memory_usage", 0) for d in all_docs]), 1) if all_docs else doc.get("memory_usage", 0)

        summary_col.update_one(
            {"pc_id": pc_id},
            {"$set": {
                "pc_id": pc_id,
                "last_seen": doc.get("timestamp", 0),
                "uptime_seconds": doc.get("uptime_seconds", 0),
                "latest_cpu": doc.get("cpu_usage", 0),
                "latest_memory": doc.get("memory_usage", 0),
                "latest_disk": doc.get("disk_usage", 0),
                "latest_connections": doc.get("total_connections", 0),
                "latest_bytes_rx": doc.get("bytes_received", 0),
                "latest_bytes_tx": doc.get("bytes_sent", 0),
                "listening_ports": doc.get("listening_ports", []),
                "listening_port_count": doc.get("listening_port_count", 0),
                "top_processes": doc.get("top_processes", []),
                "fw_top_blocked_ip": fw.get("top_blocked_ip"),
                "fw_blocked_total": fw.get("blocked_count", 0),
                "avg_cpu": avg_cpu,
                "avg_memory": avg_mem,
                "risk_score": avg_score,
                "anomaly_score": avg_score,
                "is_anomaly": data["anomaly_count"] > 0,
                "samples_analysed": len(data["scores"]),
                "detection_method": "ml" if _model else "rule-based",
                "updated_at": time.time(),
            }},
            upsert=True,
        )

    log.info(
        f"Processed {len(new_logs)} logs → "
        f"{len(alerts_to_insert)} alerts, "
        f"{len(pc_data)} PC summaries updated"
    )
    return len(new_logs)


# ─── Main loop ────────────────────────────────────────────────────────────────

def main():
    log.info("NetPulse ML Analyser starting...")
    log.info(f"MongoDB: {MONGO_URI} | DB: {MONGO_DB}")
    log.info(f"Analyse interval: {ANALYSE_INTERVAL}s | Retrain interval: {RETRAIN_INTERVAL}s")
    log.info(f"Model directory: {MODEL_DIR}")

    os.makedirs(MODEL_DIR, exist_ok=True)
    db = connect_mongo()

    # Load or train model
    model_ok = load_or_train_model(db)
    if model_ok:
        log.info("ML model loaded — using ML-based anomaly detection")
    else:
        log.info("No ML model available — using rule-based detection (will auto-train when enough data)")

    # Ensure indexes
    db[ALERTS_COL].create_index([("pc_id", 1), ("timestamp", -1)])
    db[ALERTS_COL].create_index([("resolved", 1), ("severity", 1)])
    db[SUMMARY_COL].create_index("pc_id", unique=True)

    while _running:
        try:
            n = analyse_new_logs(db)
            if n > 0:
                log.debug(f"Cycle complete — processed {n} logs")

            # Check if retraining is needed
            retrain_if_needed(db)

        except Exception as e:
            log.exception(f"Error in analysis cycle: {e}")

        # Wait for next cycle
        for _ in range(ANALYSE_INTERVAL):
            if not _running:
                break
            time.sleep(1)

    log.info("Analyser stopped.")


if __name__ == "__main__":
    main()
