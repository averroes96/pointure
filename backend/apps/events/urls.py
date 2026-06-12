from django.urls import path
from .views import sse_stream

urlpatterns = [
    path("stream/", sse_stream, name="sse-stream"),
]
