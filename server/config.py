"""
NetPulse Server — Central Configuration
All values read from environment variables with sensible defaults.
Import this module instead of repeating os.getenv() in every service.

Usage:
    from config import KAFKA_BROKER, KAFKA_TOPIC, MONGO_URI, MONGO_DB, \
                       LOGS_COLLECTION, ALERTS_COLLECTION, SUMMARY_COLLECTION
"""
import os

# ─── Kafka ────────────────────────────────────────────────────────────────────
KAFKA_BROKER   = os.getenv("KAFKA_BROKER",    "localhost:9092")
KAFKA_TOPIC    = os.getenv("KAFKA_TOPIC",     "network-logs")
KAFKA_GROUP_ID = os.getenv("KAFKA_GROUP_ID",  "netpulse-consumer-group")

# ─── MongoDB ──────────────────────────────────────────────────────────────────
MONGO_URI          = os.getenv("MONGO_URI",          "mongodb://localhost:27017/")
MONGO_DB           = os.getenv("MONGO_DB",           "netpulse")
LOGS_COLLECTION    = os.getenv("LOGS_COLLECTION",    "network_logs")
ALERTS_COLLECTION  = os.getenv("ALERTS_COLLECTION",  "alerts")
SUMMARY_COLLECTION = os.getenv("SUMMARY_COLLECTION", "summaries")

# ─── Batch consumer ───────────────────────────────────────────────────────────
BATCH_SIZE    = int(os.getenv("BATCH_SIZE",    "50"))
BATCH_TIMEOUT = float(os.getenv("BATCH_TIMEOUT", "5"))

# ─── ML analyser ──────────────────────────────────────────────────────────────
ANALYSE_INTERVAL   = int(os.getenv("ANALYSE_INTERVAL",   "60"))
RETRAIN_INTERVAL   = int(os.getenv("RETRAIN_INTERVAL",   "21600"))  # 6 hours
CONTAMINATION      = float(os.getenv("ANOMALY_CONTAMINATION", "0.05"))
MODEL_DIR          = os.getenv("MODEL_DIR", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "models"
))