from django.contrib import admin
from django.urls import include, path
from decouple import config

admin.site.site_header = "ShoeDZ / Pointure License Server"
admin.site.site_title = "License Admin"
admin.site.index_title = "License Management"

ADMIN_URL = config("ADMIN_URL", default="admin/")

urlpatterns = [
    path(ADMIN_URL, admin.site.urls),
    path("api/", include("apps.licenses.urls")),
]
