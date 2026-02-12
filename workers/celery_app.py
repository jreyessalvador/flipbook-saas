# /opt/flipbook-saas/workers/celery_app.py

from celery import Celery
import os

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

app = Celery(
    "flipbook_workers",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["tasks.pdf_import_task", "tasks.pdf_export_task", "tasks.image_optimization_task"]
)

app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=30 * 60,  # 30 minutes
    task_soft_time_limit=25 * 60,  # 25 minutes
)
