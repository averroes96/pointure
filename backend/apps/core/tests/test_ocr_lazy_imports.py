import io
import pytest
from unittest.mock import patch
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from apps.core.models import Tenant, User, RoleChoices, PlanChoices
from apps.core.services.ocr import (
    DocumentScanEngine,
    get_cv2,
    get_numpy,
    get_pil_image,
    get_rapid_ocr,
)


@pytest.mark.django_db
class TestOCRLazyImports:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.tenant = Tenant.objects.create(name="OCR Boutique", plan=PlanChoices.PRO_WHOLESALE)
        self.manager = User.objects.create_user(
            email="manager@ocr.dz",
            password="testpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.manager)

    def test_get_numpy_raises_clean_importerror_when_missing(self):
        with patch.dict("sys.modules", {"numpy": None}):
            with patch("apps.core.services.ocr.engine._NUMPY_MODULE", None):
                with pytest.raises(ImportError) as exc_info:
                    get_numpy()
                assert "NumPy" in str(exc_info.value)

    def test_get_pil_image_raises_clean_importerror_when_missing(self):
        with patch.dict("sys.modules", {"PIL": None, "PIL.Image": None}):
            with patch("apps.core.services.ocr.engine._PIL_IMAGE_MODULE", None):
                with pytest.raises(ImportError) as exc_info:
                    get_pil_image()
                assert "Pillow" in str(exc_info.value) or "PIL" in str(exc_info.value)

    def test_get_rapid_ocr_raises_clean_importerror_when_missing(self):
        with patch.dict("sys.modules", {"rapidocr_onnxruntime": None}):
            with patch("apps.core.services.ocr.engine._RAPID_OCR_INSTANCE", None):
                with pytest.raises(ImportError) as exc_info:
                    get_rapid_ocr()
                assert "RapidOCR" in str(exc_info.value)

    def test_scan_image_returns_503_when_ocr_dependency_missing(self):
        """When numpy or cv2 is missing, calling scan-image returns 503 Service Unavailable."""
        url = "/api/v1/suppliers/purchase-orders/scan-image/"
        fake_file = SimpleUploadedFile("bon.png", b"\x89PNG\r\n\x1a\nfakebytes", content_type="image/png")

        with patch("apps.core.services.ocr.engine.get_numpy", side_effect=ImportError("NumPy missing")):
            resp = self.client.post(url, {"file": fake_file}, format="multipart")
            assert resp.status_code == 503
            assert "reconnaissance optique" in resp.data.get("detail", "")

