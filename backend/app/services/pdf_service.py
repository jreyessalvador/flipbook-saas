import io
import uuid
from typing import List, Tuple
from PIL import Image
import fitz  # PyMuPDF
from app.services.minio_service import minio_service

class PDFProcessor:

    def pdf_to_images(self, pdf_bytes: bytes, dpi: int = 150) -> List[Tuple[bytes, int, int]]:
        """Convierte PDF a lista de (imagen_bytes, ancho, alto)"""
        pages = []
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        mat = fitz.Matrix(dpi/72, dpi/72)
        for page in doc:
            pix = page.get_pixmap(matrix=mat)
            img_bytes = pix.tobytes("jpeg")
            pages.append((img_bytes, pix.width, pix.height))
        doc.close()
        return pages

    def create_thumbnail(self, image_bytes: bytes, width: int = 200) -> bytes:
        """Crea thumbnail de una imagen"""
        img = Image.open(io.BytesIO(image_bytes))
        ratio = width / img.width
        height = int(img.height * ratio)
        img = img.resize((width, height), Image.LANCZOS)
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=85)
        return buffer.getvalue()

    def optimize_image(self, image_bytes: bytes, quality: int = 85, max_width: int = 1200) -> bytes:
        """Optimiza imagen para web"""
        img = Image.open(io.BytesIO(image_bytes))
        if img.width > max_width:
            ratio = max_width / img.width
            img = img.resize((max_width, int(img.height * ratio)), Image.LANCZOS)
        if img.mode != "RGB":
            img = img.convert("RGB")
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=quality, optimize=True)
        return buffer.getvalue()

    def process_pdf_upload(self, pdf_bytes: bytes, publication_id: str, bucket: str) -> List[dict]:
        """Procesa PDF completo: convierte paginas, sube a MinIO, retorna lista de paginas"""
        pages_data = self.pdf_to_images(pdf_bytes)
        result = []
        for idx, (img_bytes, width, height) in enumerate(pages_data):
            page_num = idx + 1
            optimized = self.optimize_image(img_bytes)
            thumb = self.create_thumbnail(img_bytes)
            img_key = f"publications/{publication_id}/pages/{page_num:04d}.jpg"
            thumb_key = f"publications/{publication_id}/pages/{page_num:04d}_thumb.jpg"
            img_url = minio_service.upload_file(bucket, img_key, optimized, "image/jpeg")
            thumb_url = minio_service.upload_file(bucket, thumb_key, thumb, "image/jpeg")
            result.append({
                "page_number": page_num,
                "image_url": img_url,
                "thumbnail_url": thumb_url,
                "width": width,
                "height": height
            })
        return result

pdf_processor = PDFProcessor()
