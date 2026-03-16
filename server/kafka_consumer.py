from kafka import KafkaConsumer
from pymongo import MongoClient
import json

consumer = KafkaConsumer(
    "network-logs",
    bootstrap_servers="localhost:9092",
    value_deserializer=lambda m: json.loads(m.decode("utf-8")),
)

client = MongoClient("mongodb://localhost:27017/")
db = client["netpulse"]
collection = db["network_logs"]

print("NetPulse Kafka Consumer Started...")

for message in consumer:
    log = message.value
    collection.insert_one(log)

    print(f"Stored log from {log['pc_id']}")