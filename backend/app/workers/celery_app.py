from celery import Celery
import os
from app.config import settings

queue_url = os.getenv("PDF_QUEUE_URL", settings.CELERY_BROKER_URL)
celery_app = Celery("flipbook", broker=queue_url, backend=queue_url)
celery_app.conf.update(task_serializer="json", accept_content=["json"], result_serializer="json", timezone="UTC", enable_utc=True, task_track_started=True, task_time_limit=30 * 60, task_soft_time_limit=25 * 60)
