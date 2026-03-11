from kafka import KafkaConsumer
from pymongo import MongoClient
from datetime import datetime, timezone
import json
import config

# =========================
# CONNECT TO MONGODB
# =========================
client = MongoClient(config.MONGO_URI)
db = client[config.DATABASE_NAME]
collection = db[config.COLLECTION_NAME]

# =========================
# KAFKA CONSUMER
# =========================
consumer = KafkaConsumer(
    config.TOPIC_NAME,
    bootstrap_servers=config.KAFKA_SERVER,
    value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    auto_offset_reset="latest",
    enable_auto_commit=True
)

print("NetPulse Kafka Consumer Started...")

for message in consumer:
    try:
        log_data = message.value
        log_data["received_at"] = datetime.now(timezone.utc)

        collection.insert_one(log_data)

        print(f"Stored log from {log_data['pc_id']}")

    except Exception as e:
        print("Consumer Error:", e)