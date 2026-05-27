"""Custom exception handler that formats all errors consistently."""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler


def custom_exception_handler(exc, context):
    """
    Returns errors in the format:
    {"error": {"code": "...", "message": "...", "details": {...}}}
    """
    response = exception_handler(exc, context)

    if response is not None:
        error_code = getattr(exc, "default_code", "error")
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
