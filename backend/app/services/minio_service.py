from minio import Minio
from minio.error import S3Error
from app.config import settings
import io
import uuid

class MinioService:
    def __init__(self):
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = Minio(
                settings.MINIO_ENDPOINT,
                access_key=settings.MINIO_ACCESS_KEY,
                secret_key=settings.MINIO_SECRET_KEY,
                secure=settings.MINIO_SECURE
            )
        return self._client

    def get_bucket_name(self, tenant_id: str) -> str:
        return f"{settings.MINIO_BUCKET_PREFIX}{str(tenant_id)[:8]}"

    def ensure_bucket(self, bucket: str):
        try:
            if not self.client.bucket_exists(bucket):
                self.client.make_bucket(bucket)
                policy = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::' + bucket + '/public/*"]}]}'
                self.client.set_bucket_policy(bucket, policy)
        except S3Error as e:
            raise Exception(f"MinIO bucket error: {e}")

    def upload_file(self, bucket: str, object_key: str, data: bytes, content_type: str) -> str:
        self.ensure_bucket(bucket)
        self.client.put_object(
            bucket, object_key,
            io.BytesIO(data), len(data),
            content_type=content_type
        )
        return f"/{bucket}/{object_key}"

    def get_presigned_url(self, bucket: str, object_key: str, expires_hours: int = 24) -> str:
        from datetime import timedelta
        return self.client.presigned_get_object(bucket, object_key, expires=timedelta(hours=expires_hours))

    def delete_file(self, bucket: str, object_key: str):
        try:
            self.client.remove_object(bucket, object_key)
        except S3Error:
            pass

    def get_public_url(self, bucket: str, object_key: str) -> str:
        endpoint = settings.MINIO_ENDPOINT.replace(":9000","")
        proto = "https" if settings.MINIO_SECURE else "http"
        return f"{proto}://{settings.MINIO_ENDPOINT}/{bucket}/{object_key}"

minio_service = MinioService()
