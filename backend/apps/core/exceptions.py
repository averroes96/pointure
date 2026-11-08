"""Custom exception handler that formats all errors consistently."""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler


def custom_exception_handler(exc, context):
    """
    Returns errors in the format:
    {"error": {"code": "...", "message": "...", "details": {...}}}
    """
    from django.core.exceptions import ValidationError as DjangoValidationError
    from rest_framework.exceptions import ValidationError as DRFValidationError

    if isinstance(exc, DjangoValidationError):
        code = getattr(exc, "code", "invalid") or "invalid"
        if hasattr(exc, "message_dict"):
            exc = DRFValidationError(detail=exc.message_dict, code=code)
        elif hasattr(exc, "messages"):
            exc = DRFValidationError(detail=exc.messages, code=code)
        else:
            exc = DRFValidationError(detail=str(exc), code=code)
        exc.default_code = code

    response = exception_handler(exc, context)

    if response is not None:
        error_code = getattr(exc, "default_code", "error")
        if error_code in ("error", "invalid") and hasattr(exc, "get_codes"):
            codes = exc.get_codes()
            if isinstance(codes, str):
                error_code = codes
            elif isinstance(codes, list) and codes:
                error_code = codes[0]
            elif isinstance(codes, dict):
                first_val = next(iter(codes.values()), None)
                if isinstance(first_val, list) and first_val:
                    error_code = first_val[0]
                elif isinstance(first_val, str):
                    error_code = first_val

        message = str(exc.detail) if hasattr(exc, "detail") else str(exc)

        # For validation errors, the detail is a dict/list
        details = {}
        if hasattr(exc, "detail"):
            if isinstance(exc.detail, dict):
                details = exc.detail
            elif isinstance(exc.detail, list):
                details = {"non_field_errors": exc.detail}

        response.data = {
            "error": {
                "code": error_code,
                "message": message,
                "details": details,
                "status_code": response.status_code,
            }
        }

    return response
