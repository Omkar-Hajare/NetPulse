"""
NetPulse Server Configuration
All values read from environment variables with sensible defaults.
"""
import os

KAFKA_SERVER    = os.getenv("KAFKA_BROKER",     "localhost:9092")
TOPIC_NAME      = os.getenv("KAFKA_TOPIC",      "network-logs")
MONGO_URI       = os.getenv("MONGO_URI",         "mongodb://localhost:27017/")
DATABASE_NAME   = os.getenv("MONGO_DB",          "netpulse")
COLLECTION_NAME = os.getenv("MONGO_COLLECTION",  "network_logs")