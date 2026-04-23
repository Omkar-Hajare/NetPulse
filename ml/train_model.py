"""
NetPulse — ML Anomaly Detection: Model Training Script

Trains an Isolation Forest model on historical network log data from MongoDB.
The model learns "normal" behavior patterns and flags outliers as anomalies.

USAGE:
    python train_model.py                         # train on all data
    python train_model.py --hours 168             # train on last 7 days
    python train_model.py --contamination 0.05    # expect 5% anomalies
    python train_model.py --output ./models       # save to custom path

FEATURES used for training:
    - cpu_usage, memory_usage, disk_usage
    - bytes_sent, bytes_received (+ computed ratio)
    - total_connections, unique_remote_ips
    - tcp_udp_ratio (computed)
    - suspicious_port_access, potential_port_scan
    - firewall blocked_count
    - listening_port_count
"""

import os
import sys
import json
import time
import argparse
import logging

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import joblib
from pymongo import MongoClient

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("netpulse-ml")

# ─── Configuration ────────────────────────────────────────────────────────────

MONGO_URI   = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
MONGO_DB    = os.getenv("MONGO_DB", "netpulse")
COLLECTION  = os.getenv("MONGO_COLLECTION", "network_logs")

# Features the model is trained on
FEATURE_COLUMNS = [
    "cpu_usage",
    "memory_usage",
    "disk_usage",
    "bytes_sent",
    "bytes_received",
    "bytes_ratio",           # computed: sent / (received + 1)
    "total_connections",
    "unique_remote_ips",
    "tcp_udp_ratio",         # computed: tcp / (udp + 1)
    "suspicious_port_access",
    "potential_port_scan",
    "fw_blocked_count",      # from firewall.blocked_count
    "listening_port_count",
]


# ─── Feature extraction ──────────────────────────────────────────────────────

def extract_features(docs: list) -> pd.DataFrame:
    """Convert raw MongoDB log documents into a feature DataFrame."""
    rows = []
    for doc in docs:
        fw = doc.get("firewall", {})
        tcp = doc.get("tcp_count", 0) or 0
        udp = doc.get("udp_count", 0) or 0
        bytes_sent = doc.get("bytes_sent", 0) or 0
        bytes_received = doc.get("bytes_received", 0) or 0

        row = {
            "pc_id":                  doc.get("pc_id", "unknown"),
            "timestamp":              doc.get("timestamp", 0),
            "cpu_usage":              doc.get("cpu_usage", 0) or 0,
            "memory_usage":           doc.get("memory_usage", 0) or 0,
            "disk_usage":             doc.get("disk_usage", 0) or 0,
            "bytes_sent":             bytes_sent,
            "bytes_received":         bytes_received,
            "bytes_ratio":            round(bytes_sent / (bytes_received + 1), 4),
            "total_connections":      doc.get("total_connections", 0) or 0,
            "unique_remote_ips":      doc.get("unique_remote_ips", 0) or 0,
            "tcp_udp_ratio":          round(tcp / (udp + 1), 4),
            "suspicious_port_access": doc.get("suspicious_port_access", 0) or 0,
            "potential_port_scan":    doc.get("potential_port_scan", 0) or 0,
            "fw_blocked_count":       fw.get("blocked_count", 0) or 0,
            "listening_port_count":   doc.get("listening_port_count", 0) or 0,
        }
        rows.append(row)

    df = pd.DataFrame(rows)
    return df


# ─── Training ─────────────────────────────────────────────────────────────────

def train_model(
    hours: int = 0,
    contamination: float = 0.05,
    output_dir: str = None,
    n_estimators: int = 200,
    random_state: int = 42,
):
    """
    Train an Isolation Forest model on MongoDB data.

    Args:
        hours: Train on last N hours of data (0 = all data)
        contamination: Expected fraction of anomalies (0.01 to 0.5)
        output_dir: Directory to save model artifacts
        n_estimators: Number of trees in the forest
        random_state: Random seed for reproducibility
    """
    if output_dir is None:
        output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
    os.makedirs(output_dir, exist_ok=True)

    # ── Connect to MongoDB ──
    log.info(f"Connecting to MongoDB at {MONGO_URI}...")
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    collection = client[MONGO_DB][COLLECTION]

    # ── Fetch training data ──
    query = {}
    if hours > 0:
        cutoff = time.time() - (hours * 3600)
        query = {"timestamp": {"$gte": cutoff}}

    total_docs = collection.count_documents(query)
    log.info(f"Found {total_docs} documents for training")

    if total_docs < 50:
        log.error(
            f"Not enough data for training ({total_docs} docs). "
            "Need at least 50. Run agents longer to collect more data, "
            "or use --generate-synthetic to create training data."
        )
        sys.exit(1)

    docs = list(collection.find(query, {"_id": 0}))

    # ── Extract features ──
    log.info("Extracting features...")
    df = extract_features(docs)
    X = df[FEATURE_COLUMNS].values

    log.info(f"Feature matrix shape: {X.shape}")
    log.info(f"PCs in training set: {df['pc_id'].nunique()}")

    # ── Scale features ──
    log.info("Scaling features...")
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # ── Train Isolation Forest ──
    log.info(
        f"Training Isolation Forest "
        f"(n_estimators={n_estimators}, contamination={contamination})..."
    )
    model = IsolationForest(
        n_estimators=n_estimators,
        contamination=contamination,
        max_features=1.0,
        bootstrap=True,
        random_state=random_state,
        n_jobs=-1,              # use all CPU cores
        verbose=0,
    )
    model.fit(X_scaled)

    # ── Evaluate on training data ──
    predictions = model.predict(X_scaled)
    scores = model.score_samples(X_scaled)

    n_anomalies = (predictions == -1).sum()
    n_normal = (predictions == 1).sum()

    log.info(f"Training results:")
    log.info(f"  Normal samples:  {n_normal} ({100 * n_normal / len(predictions):.1f}%)")
    log.info(f"  Anomaly samples: {n_anomalies} ({100 * n_anomalies / len(predictions):.1f}%)")
    log.info(f"  Score range:     [{scores.min():.4f}, {scores.max():.4f}]")
    log.info(f"  Score mean:      {scores.mean():.4f}")
    log.info(f"  Score std:       {scores.std():.4f}")

    # ── Save artifacts ──
    model_path = os.path.join(output_dir, "anomaly_model.pkl")
    scaler_path = os.path.join(output_dir, "scaler.pkl")
    meta_path = os.path.join(output_dir, "model_metadata.json")

    joblib.dump(model, model_path)
    joblib.dump(scaler, scaler_path)

    metadata = {
        "trained_at": time.time(),
        "trained_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_samples": len(docs),
        "unique_pcs": df["pc_id"].nunique(),
        "pc_ids": sorted(df["pc_id"].unique().tolist()),
        "features": FEATURE_COLUMNS,
        "n_estimators": n_estimators,
        "contamination": contamination,
        "n_anomalies_in_training": int(n_anomalies),
        "n_normal_in_training": int(n_normal),
        "score_mean": float(scores.mean()),
        "score_std": float(scores.std()),
        "score_min": float(scores.min()),
        "score_max": float(scores.max()),
        "hours_filter": hours if hours > 0 else "all",
    }
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)

    log.info(f"Model saved to:    {model_path}")
    log.info(f"Scaler saved to:   {scaler_path}")
    log.info(f"Metadata saved to: {meta_path}")
    log.info("Training complete!")

    return model, scaler, metadata


# ─── Generate synthetic training data ─────────────────────────────────────────

def generate_synthetic_data(n_samples: int = 500, n_pcs: int = 5):
    """
    Generate synthetic training data and insert into MongoDB.
    Useful when you don't have enough real data yet.
    """
    import random
    import math

    log.info(f"Generating {n_samples} synthetic samples for {n_pcs} PCs...")

    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    collection = client[MONGO_DB][COLLECTION]

    pcs = [f"TRAIN-PC-{i:02d}" for i in range(1, n_pcs + 1)]
    now = time.time()
    docs = []

    for i in range(n_samples):
        pc_id = pcs[i % n_pcs]
        ts = now - (n_samples - i) * 60  # 1 minute apart

        # Normal behavior baseline
        cpu = round(max(0, min(100, 25 + 15 * math.sin(i / 10) + random.gauss(0, 8))), 1)
        mem = round(max(0, min(100, 50 + 10 * math.cos(i / 15) + random.gauss(0, 5))), 1)

        # Inject ~5% anomalies
        is_attack = random.random() < 0.05
        if is_attack:
            cpu = round(min(100, cpu + random.uniform(30, 60)), 1)
            extra_conns = random.randint(50, 200)
            extra_ips = random.randint(20, 100)
            suspicious = random.randint(1, 5)
            port_scan = random.randint(1, 3)
            blocked = random.randint(50, 200)
        else:
            extra_conns = 0
            extra_ips = 0
            suspicious = 0
            port_scan = 0
            blocked = random.randint(0, 10)

        tcp = random.randint(5, 30) + extra_conns
        udp = random.randint(2, 15)

        doc = {
            "pc_id": pc_id,
            "timestamp": ts,
            "cpu_usage": cpu,
            "memory_usage": mem,
            "disk_usage": round(40 + random.gauss(0, 5), 1),
            "uptime_seconds": 86400 + i * 60,
            "bytes_sent": random.randint(50000, 5000000),
            "bytes_received": random.randint(100000, 8000000),
            "packets_sent": random.randint(100, 5000),
            "packets_received": random.randint(200, 8000),
            "interface_speed_mbps": 1000,
            "tcp_count": tcp,
            "udp_count": udp,
            "total_connections": tcp + udp,
            "unique_remote_ips": random.randint(3, 20) + extra_ips,
            "listening_ports": sorted(random.sample([22, 80, 443, 3000, 8080], random.randint(2, 4))),
            "listening_port_count": random.randint(2, 5),
            "suspicious_port_access": suspicious,
            "potential_port_scan": port_scan,
            "total_processes": random.randint(80, 250),
            "top_processes": [
                {"name": "chrome.exe", "cpu": round(random.uniform(2, 15), 1), "memory": round(random.uniform(5, 20), 1)},
                {"name": "python.exe", "cpu": round(random.uniform(1, 10), 1), "memory": round(random.uniform(3, 12), 1)},
            ],
            "firewall": {
                "blocked_count": blocked,
                "allowed_count": random.randint(50, 500),
                "blocked_ips": [],
                "blocked_ports": [],
                "top_blocked_ip": None,
            },
            "_synthetic": True,  # mark so we can clean up later
        }
        docs.append(doc)

    collection.insert_many(docs)
    log.info(f"Inserted {len(docs)} synthetic documents into MongoDB")
    return docs


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Train NetPulse anomaly detection model"
    )
    parser.add_argument(
        "--hours", type=int, default=0,
        help="Train on last N hours of data (0 = all data)"
    )
    parser.add_argument(
        "--contamination", type=float, default=0.05,
        help="Expected fraction of anomalies (default: 0.05)"
    )
    parser.add_argument(
        "--output", type=str, default=None,
        help="Output directory for model files"
    )
    parser.add_argument(
        "--n-estimators", type=int, default=200,
        help="Number of trees in the forest (default: 200)"
    )
    parser.add_argument(
        "--generate-synthetic", action="store_true",
        help="Generate synthetic training data first"
    )
    parser.add_argument(
        "--synthetic-samples", type=int, default=500,
        help="Number of synthetic samples to generate (default: 500)"
    )

    args = parser.parse_args()

    if args.generate_synthetic:
        generate_synthetic_data(n_samples=args.synthetic_samples)

    train_model(
        hours=args.hours,
        contamination=args.contamination,
        output_dir=args.output,
        n_estimators=args.n_estimators,
    )


if __name__ == "__main__":
    main()
