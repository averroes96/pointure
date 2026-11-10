"""
Layer 1 — Agnostic Vision & Spatial OCR Engine (`DocumentScanEngine`).
Provides offline OpenCV image preprocessing (aspect-ratio resize, grayscale,
Otsu/adaptive binarization, Hough/minAreaRect deskewing, morphological grid enhancement),
RapidOCR text extraction with polygon bounding boxes, and spatial row/band clustering.
"""
import io
import logging
import math
from typing import Any, Dict, List, Optional, Tuple, Union

from apps.core.services.ocr.schema import OCRToken

logger = logging.getLogger(__name__)

_RAPID_OCR_INSTANCE = None
_CV2_MODULE = None
_NUMPY_MODULE = None
_PIL_IMAGE_MODULE = None


def get_cv2():
    """
    Lazily loads OpenCV (cv2) so that importing OCR modules or loading Django's
    URL configuration never fails at application startup if native libraries are missing.
    """
    global _CV2_MODULE
    if _CV2_MODULE is None:
        try:
            import cv2
            _CV2_MODULE = cv2
        except ImportError as e:
            logger.warning("OpenCV (cv2) is not available: %s", e)
            raise ImportError(
                "Le module de traitement d'image OpenCV (cv2) n'est pas disponible. "
                "Sous Linux/Docker, vérifiez que 'libgl1' et 'libglib2.0-0' sont installés."
            ) from e
    return _CV2_MODULE


def get_numpy():
    """
    Lazily loads NumPy so that importing OCR modules or loading Django's
    URL configuration never fails at application startup if NumPy is missing.
    """
    global _NUMPY_MODULE
    if _NUMPY_MODULE is None:
        try:
            import numpy as np
            _NUMPY_MODULE = np
        except ImportError as e:
            logger.warning("NumPy is not available: %s", e)
            raise ImportError(
                "Le module NumPy n'est pas disponible dans cet environnement."
            ) from e
    return _NUMPY_MODULE


def get_pil_image():
    """
    Lazily loads PIL.Image so that importing OCR modules or loading Django's
    URL configuration never fails at application startup if Pillow is missing.
    """
    global _PIL_IMAGE_MODULE
    if _PIL_IMAGE_MODULE is None:
        try:
            from PIL import Image
            _PIL_IMAGE_MODULE = Image
        except ImportError as e:
            logger.warning("PIL (Pillow) is not available: %s", e)
            raise ImportError(
                "Le module Pillow (PIL) n'est pas disponible dans cet environnement."
            ) from e
    return _PIL_IMAGE_MODULE


def get_rapid_ocr():
    """Singleton loader for RapidOCR to avoid reloading ONNX models on every request."""
    global _RAPID_OCR_INSTANCE
    if _RAPID_OCR_INSTANCE is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
            _RAPID_OCR_INSTANCE = RapidOCR()
        except ImportError as e:
            logger.warning("RapidOCR is not available: %s", e)
            raise ImportError(
                "Le module RapidOCR n'est pas disponible dans cet environnement."
            ) from e
    return _RAPID_OCR_INSTANCE


class DocumentScanEngine:
    """
    Domain-agnostic computer vision and spatial OCR engine.
    Contains zero footwear or purchase-order business logic.
    """

    def __init__(self, max_dimension: int = 2000):
        self.max_dimension = max_dimension

    @staticmethod
    def load_image(image_input: Union[bytes, Any]) -> Any:
        """
        Loads an image from raw bytes, PIL Image, or numpy array into a BGR numpy array.
        """
        cv2 = get_cv2()
        np = get_numpy()
        Image = get_pil_image()

        if hasattr(image_input, "ndim"):
            if image_input.ndim == 2:
                return cv2.cvtColor(image_input, cv2.COLOR_GRAY2BGR)
            if image_input.shape[2] == 4:
                return cv2.cvtColor(image_input, cv2.COLOR_RGBA2BGR)
            return image_input.copy()

        if hasattr(image_input, "convert") and hasattr(image_input, "mode"):
            rgb = image_input.convert("RGB")
            arr = np.array(rgb)
            return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)

        if isinstance(image_input, (bytes, bytearray)):
            nparr = np.frombuffer(image_input, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is not None:
                return img
            # Fallback via Pillow
            pil_img = Image.open(io.BytesIO(image_input)).convert("RGB")
            return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

        raise ValueError(f"Unsupported image input type: {type(image_input)}")

    @staticmethod
    def resize_preserving_aspect(img: Any, max_dim: int = 2000) -> Tuple[Any, float]:
        """
        Resizes image so that max(width, height) <= max_dim while preserving aspect ratio.
        Returns (resized_img, scale_factor).
        """
        cv2 = get_cv2()
        h, w = img.shape[:2]
        longest = max(h, w)
        if longest <= max_dim or max_dim <= 0:
            return img, 1.0

        scale = max_dim / float(longest)
        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))
        resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
        return resized, scale

    @staticmethod
    def to_grayscale(img: Any) -> Any:
        """Converts BGR image to single-channel grayscale."""
        cv2 = get_cv2()
        if img.ndim == 2:
            return img
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    @classmethod
    def binarize(cls, gray_img: Any, method: str = "otsu") -> Any:
        """
        Applies Otsu or adaptive Gaussian binarization to a grayscale image.
        """
        cv2 = get_cv2()
        gray = cls.to_grayscale(gray_img)
        blurred = cv2.GaussianBlur(gray, (3, 3), 0)
        if method == "adaptive":
            return cv2.adaptiveThreshold(
                blurred,
                255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY,
                25,
                11,
            )
        _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        return thresh

    @classmethod
    def estimate_skew_angle(cls, img: Any) -> float:
        """
        Estimates document skew angle within [-45, +45] degrees using horizontal
        morphological dilation + Probabilistic Hough Transform, with minAreaRect fallback.
        """
        from statistics import median

        cv2 = get_cv2()
        np = get_numpy()
        gray = cls.to_grayscale(img)
        h, w = gray.shape[:2]

        # Invert so dark text becomes foreground (white)
        inv = cv2.bitwise_not(gray)
        _, binary = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)

        # Connect characters along horizontal text lines
        kernel_w = max(15, w // 35)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_w, 3))
        dilated = cv2.dilate(binary, kernel, iterations=1)

        angles: List[float] = []

        # 1. HoughLinesP on text strips
        lines = cv2.HoughLinesP(
            dilated,
            rho=1,
            theta=math.pi / 180.0,
            threshold=max(40, w // 15),
            minLineLength=max(40, w // 10),
            maxLineGap=20,
        )
        if lines is not None:
            for line in lines:
                x1, y1, x2, y2 = np.asarray(line).reshape(4)
                if x2 == x1:
                    continue
                angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
                if -45.0 <= angle <= 45.0:
                    angles.append(angle)

        # 2. Fallback to minAreaRect on text block contours
        if not angles:
            contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for cnt in contours:
                area = cv2.contourArea(cnt)
                if area < 200:
                    continue
                rect = cv2.minAreaRect(cnt)
                (_, _), (rw, rh), rect_angle = rect
                if rw < 1 or rh < 1:
                    continue
                # Normalize OpenCV minAreaRect angle to [-45, 45]
                if rw < rh:
                    rect_angle = rect_angle + 90.0
                if rect_angle > 45.0:
                    rect_angle -= 90.0
                elif rect_angle < -45.0:
                    rect_angle += 90.0
                if -45.0 <= rect_angle <= 45.0:
                    angles.append(rect_angle)

        if not angles:
            return 0.0

        median_angle = float(median(angles))
        if abs(median_angle) < 0.25 or abs(median_angle) > 45.0:
            return 0.0
        return round(median_angle, 2)

    @classmethod
    def deskew(cls, img: Any, angle: Optional[float] = None) -> Tuple[Any, float]:
        """
        Rotates the image to correct skew within ±45 degrees.
        Returns (deskewed_image, applied_angle).
        """
        cv2 = get_cv2()
        if angle is None:
            angle = cls.estimate_skew_angle(img)
        if abs(angle) < 0.25 or abs(angle) > 45.0:
            return img, 0.0

        h, w = img.shape[:2]
        center = (w / 2.0, h / 2.0)
        rot_mat = cv2.getRotationMatrix2D(center, angle, 1.0)
        border_val = (255, 255, 255) if img.ndim == 3 else 255
        rotated = cv2.warpAffine(
            img,
            rot_mat,
            (w, h),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=border_val,
        )
        return rotated, angle

    @classmethod
    def enhance_table_grid(cls, img: Any) -> Any:
        """
        Detects horizontal and vertical table grid lines via morphological operations
        and returns a grid mask (or grid-enhanced image).
        """
        cv2 = get_cv2()
        gray = cls.to_grayscale(img)
        inv = cv2.bitwise_not(gray)
        _, binary = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)

        h, w = gray.shape[:2]
        horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, w // 25), 1))
        vert_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(20, h // 25)))

        horiz_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horiz_kernel, iterations=1)
        vert_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vert_kernel, iterations=1)
        grid_mask = cv2.bitwise_or(horiz_lines, vert_lines)
        return grid_mask

    @classmethod
    def normalize_illumination(cls, gray_img: Any) -> Any:
        """
        Normalizes uneven phone-camera lighting/shadows using background division and CLAHE.
        """
        cv2 = get_cv2()
        np = get_numpy()
        gray = cls.to_grayscale(gray_img)
        # Estimate background illumination via large morphological closing / blur
        dilated = cv2.dilate(gray, np.ones((7, 7), np.uint8))
        bg = cv2.medianBlur(dilated, 21)
        diff = 255 - cv2.absdiff(gray, bg)
        norm = cv2.normalize(diff, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        return clahe.apply(norm)

    def preprocess(
        self,
        image_input: Union[bytes, Any],
        deskew: bool = True,
        binarize_method: Optional[str] = None,
        normalize_lighting: bool = False,
    ) -> Tuple[Any, Dict[str, Any]]:
        """
        Runs the OpenCV preprocessing pipeline:
        1. Aspect-ratio-preserving resize (max 2000px)
        2. Optional deskewing (±45°)
        3. Optional shadow/lighting normalization or Otsu/adaptive binarization
        Returns (processed_image, preprocessing_metadata).
        """
        cv2 = get_cv2()
        raw_img = self.load_image(image_input)
        orig_h, orig_w = raw_img.shape[:2]

        resized_img, scale = self.resize_preserving_aspect(raw_img, self.max_dimension)
        applied_angle = 0.0
        if deskew:
            resized_img, applied_angle = self.deskew(resized_img)

        proc_img = resized_img
        if normalize_lighting:
            norm_gray = self.normalize_illumination(proc_img)
            proc_img = cv2.cvtColor(norm_gray, cv2.COLOR_GRAY2BGR)
        elif binarize_method in ("otsu", "adaptive"):
            bin_img = self.binarize(proc_img, method=binarize_method)
            proc_img = cv2.cvtColor(bin_img, cv2.COLOR_GRAY2BGR)

        proc_h, proc_w = proc_img.shape[:2]
        meta = {
            "original_width": orig_w,
            "original_height": orig_h,
            "width": proc_w,
            "height": proc_h,
            "scale": round(scale, 4),
            "skew_angle": applied_angle,
        }
        return proc_img, meta

    @staticmethod
    def polygon_to_bbox(polygon: List[List[float]]) -> List[float]:
        """Converts 4-point polygon [[x1,y1], [x2,y2], [x3,y3], [x4,y4]] to [x1, y1, x2, y2]."""
        xs = [ float(pt[0]) for pt in polygon ]
        ys = [ float(pt[1]) for pt in polygon ]
        return [min(xs), min(ys), max(xs), max(ys)]

    def extract_tokens(
        self,
        image_input: Union[bytes, Any],
        deskew: bool = True,
    ) -> Tuple[List[OCRToken], Dict[str, Any]]:
        """
        Preprocesses the image and runs RapidOCR to extract spatial text tokens.
        If uneven lighting causes low detection count, automatically retries with
        illumination normalization.
        """
        proc_img, meta = self.preprocess(image_input, deskew=deskew)
        ocr = get_rapid_ocr()
        raw_result, _ = ocr(proc_img)

        # Fallback: if very few tokens found on a potentially shadowy photo, retry with illumination normalization
        if not raw_result or len(raw_result) < 2:
            norm_img, _ = self.preprocess(image_input, deskew=deskew, normalize_lighting=True)
            retry_result, _ = ocr(norm_img)
            if retry_result and len(retry_result) > (len(raw_result) if raw_result else 0):
                raw_result = retry_result

        tokens: List[OCRToken] = []
        if raw_result:
            for item in raw_result:
                polygon, text, score = item[0], str(item[1]).strip(), float(item[2])
                if not text:
                    continue
                bbox = self.polygon_to_bbox(polygon)
                poly_clean = [[round(float(p[0]), 1), round(float(p[1]), 1)] for p in polygon]
                tokens.append(
                    OCRToken(
                        text=text,
                        bbox=bbox,
                        confidence=score,
                        polygon=poly_clean,
                    )
                )

        return tokens, meta

    @staticmethod
    def cluster_rows(
        tokens: List[OCRToken],
        y_threshold_ratio: float = 0.55,
    ) -> List[List[OCRToken]]:
        """
        Clusters spatial tokens into horizontal text rows based on vertical center
        proximity and vertical bounding-box overlap.
        Within each row, tokens are sorted left-to-right by x1.
        Rows are sorted top-to-bottom by average y1.
        """
        if not tokens:
            return []

        from statistics import median

        heights = [t.height for t in tokens if t.height > 0]
        median_h = float(median(heights)) if heights else 20.0
        y_threshold = max(6.0, median_h * y_threshold_ratio)

        # Sort tokens top-to-bottom by vertical center
        sorted_tokens = sorted(tokens, key=lambda t: (t.cy, t.x1))
        rows: List[List[OCRToken]] = []

        for tok in sorted_tokens:
            placed = False
            best_row_idx = -1
            best_dist = float("inf")

            for idx, row in enumerate(rows):
                row_cy = sum(r.cy for r in row) / len(row)
                row_y1 = min(r.y1 for r in row)
                row_y2 = max(r.y2 for r in row)

                # Vertical center distance check
                dist = abs(tok.cy - row_cy)
                # Vertical overlap check
                overlap = max(0.0, min(tok.y2, row_y2) - max(tok.y1, row_y1))
                min_h = max(1.0, min(tok.height, row_y2 - row_y1))
                overlap_ratio = overlap / min_h

                if dist <= y_threshold or overlap_ratio >= 0.45:
                    if dist < best_dist:
                        best_dist = dist
                        best_row_idx = idx
                        placed = True

            if placed and best_row_idx >= 0:
                rows[best_row_idx].append(tok)
            else:
                rows.append([tok])

        # Sort tokens within each row left-to-right
        for row in rows:
            row.sort(key=lambda t: t.x1)

        # Sort rows top-to-bottom
        rows.sort(key=lambda r: sum(t.cy for t in r) / len(r))
        return rows

    @staticmethod
    def split_wide_token(token: OCRToken, delimiter_pattern: str = r"\s{2,}") -> List[OCRToken]:
        """
        Sub-segments a wide OCRToken into proportional horizontal virtual tokens
        when the OCR detector merges multiple spaced columns into a single bounding box.
        """
        text = token.text.strip()
        if not text:
            return [token]

        import re
        parts = [p.strip() for p in re.split(delimiter_pattern, text) if p.strip()]
        if len(parts) <= 1:
            return [token]

        total_chars = max(1, len(text))
        sub_tokens: List[OCRToken] = []
        search_pos = 0

        for part in parts:
            idx = text.find(part, search_pos)
            if idx < 0:
                idx = search_pos
            end_idx = idx + len(part)
            search_pos = end_idx

            x1 = token.x1 + (idx / total_chars) * token.width
            x2 = token.x1 + (end_idx / total_chars) * token.width
            sub_tokens.append(
                OCRToken(
                    text=part,
                    bbox=[round(x1, 1), token.y1, round(x2, 1), token.y2],
                    confidence=token.confidence,
                    polygon=token.polygon,
                )
            )

        return sub_tokens
