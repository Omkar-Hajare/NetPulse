import json
import logging
import os
import signal
import sys
import time

from kafka import KafkaConsumer
from kafka.errors import KafkaError
from pymongo import MongoClient, errors as mongo_errors
from pymongo import UpdateOne

# ─── Configuration ────────────────────────────────────────────────────────────

KAFKA_BROKER    = os.getenv("KAFKA_BROKER", "localhost:9092")
KAFKA_TOPIC     = os.getenv("KAFKA_TOPIC", "network-logs")
KAFKA_GROUP_ID  = os.getenv("KAFKA_GROUP_ID", "netpulse-consumer-group")
MONGO_URI       = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
MONGO_DB        = os.getenv("MONGO_DB", "netpulse")
MONGO_COLLECTION = os.getenv("MONGO_COLLECTION", "network_logs")

BATCH_SIZE      = int(os.getenv("BATCH_SIZE", "50"))     # flush after N messages
BATCH_TIMEOUT   = float(os.getenv("BATCH_TIMEOUT", "5")) # or after N seconds
LOG_FILE        = os.getenv("LOG_FILE", "netpulse_consumer.log")

# ─── Logging setup ────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("netpulse-consumer")

# ─── MongoDB connection ───────────────────────────────────────────────────────

def connect_mongo(retries=5, delay=5):
    for attempt in range(1, retries + 1):
        try:
            client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
            client.admin.command("ping")    # verify connection is alive
            collection = client[MONGO_DB][MONGO_COLLECTION]

            # Ensure a unique compound index so duplicate messages never get stored
            collection.create_index(
                [("pc_id", 1), ("timestamp", 1)],
                unique=True,
                background=True,
            )
            log.info(f"Connected to MongoDB at {MONGO_URI}")
            return collection
        except mongo_errors.ServerSelectionTimeoutError:
            log.warning(f"MongoDB not reachable (attempt {attempt}/{retries}). Retrying in {delay}s...")
            time.sleep(delay)
    log.error("Could not connect to MongoDB. Exiting.")
    sys.exit(1)

# ─── Kafka consumer ───────────────────────────────────────────────────────────

def create_consumer():
    return KafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=KAFKA_BROKER,
        group_id=KAFKA_GROUP_ID,            # enables offset tracking across restarts
        auto_offset_reset="earliest",       # catch up from last committed offset
        enable_auto_commit=False,           # we commit manually after a successful write
        value_deserializer=lambda m: json.loads(m.decode("utf-8")),
        max_poll_records=BATCH_SIZE,        # aligns Kafka polling with our batch size
        session_timeout_ms=30_000,
        heartbeat_interval_ms=10_000,
    )

# ─── Batch writer ─────────────────────────────────────────────────────────────

def flush_batch(collection, batch, consumer):
    """Write a batch to MongoDB, then commit offsets only on success."""
    if not batch:
        return

    # Use upsert to handle any duplicates gracefully (idempotent writes)
    operations = [
        UpdateOne(
            {"pc_id": doc["pc_id"], "timestamp": doc["timestamp"]},
            {"$setOnInsert": doc},
            upsert=True,
        )
        for doc in batch
    ]

    try:
        result = collection.bulk_write(operations, ordered=False)
        inserted = result.upserted_count
        skipped  = len(batch) - inserted

        log.info(
            f"Batch written — {inserted} new, {skipped} duplicates skipped "
            f"(batch size: {len(batch)})"
        )

        # Only commit Kafka offsets AFTER the DB write succeeds
        # This prevents data loss if Mongo write fails mid-batch
        consumer.commit()

    except mongo_errors.BulkWriteError as bwe:
        # Log write errors but don't crash — non-duplicate errors surface here
        write_errors = [e for e in bwe.details.get("writeErrors", []) if e.get("code") != 11000]
        if write_errors:
            log.error(f"MongoDB write errors: {write_errors}")
        else:
            log.warning("Duplicate key conflicts in batch — all resolved by upsert.")
        # Still commit so Kafka doesn't redeliver the same bad messages forever
        consumer.commit()

    except mongo_errors.PyMongoError as e:
        log.error(f"MongoDB batch write failed: {e}. Offsets NOT committed — will retry.")
        # Do NOT commit — Kafka will redeliver this batch on next poll

# ─── Graceful shutdown ────────────────────────────────────────────────────────

_running = True

def handle_signal(signum, frame):
    global _running
    log.info(f"Signal {signum} received. Draining remaining messages...")
    _running = False

signal.signal(signal.SIGINT,  handle_signal)
signal.signal(signal.SIGTERM, handle_signal)

# ─── Main loop ────────────────────────────────────────────────────────────────

def main():
    log.info("NetPulse Kafka Consumer starting...")
    log.info(f"Broker: {KAFKA_BROKER} | Topic: {KAFKA_TOPIC} | Group: {KAFKA_GROUP_ID}")
    log.info(f"Batch size: {BATCH_SIZE} messages or {BATCH_TIMEOUT}s timeout")

    collection = connect_mongo()
    consumer   = create_consumer()

    batch      = []
    last_flush = time.monotonic()

    try:
        while _running:
            # poll() is non-blocking with a short timeout so we can check _running
            records = consumer.poll(timeout_ms=1000)

            for topic_partition, messages in records.items():
                for message in messages:
                    try:
                        doc = message.value
                        # Basic schema validation
                        if "pc_id" not in doc or "timestamp" not in doc:
                            log.warning(f"Skipping malformed message: {doc}")
                            continue
                        batch.append(doc)
                    except (json.JSONDecodeError, TypeError) as e:
                        log.warning(f"Could not parse message: {e}")
                        continue

            # Flush when batch is full or timeout exceeded
            elapsed = time.monotonic() - last_flush
            if len(batch) >= BATCH_SIZE or (batch and elapsed >= BATCH_TIMEOUT):
                flush_batch(collection, batch, consumer)
                batch      = []
                last_flush = time.monotonic()

    except KafkaError as e:
        log.error(f"Kafka error: {e}")
    finally:
        # Drain whatever is left in the buffer before exiting
        if batch:
            log.info(f"Flushing remaining {len(batch)} messages before shutdown...")
            flush_batch(collection, batch, consumer)
        consumer.close()
        log.info("Consumer closed cleanly.")


if __name__ == "__main__":
    main()