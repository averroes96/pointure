"""Custom AdminSite with branding and a KPI overview dashboard."""
from django.contrib import admin
from django.db.models import Count
from django.template.response import TemplateResponse
from django.urls import path


class ShoeDZAdminSite(admin.AdminSite):
    site_header = "👟 ShoeDZ Administration"
    site_title = "ShoeDZ Admin"
    index_title = "Tableau de bord"

    def get_urls(self):
        urls = super().get_urls()
        return [path("", self.admin_view(self.index), name="index")] + urls[1:]

    def index(self, request, extra_context=None):
        from apps.core.models import Tenant, User
        from apps.core.models import AuditLog

        # KPI aggregates
        tenants = Tenant.objects.all()
        total_tenants = tenants.count()
        active_tenants = tenants.filter(is_active=True).count()
        suspended_tenants = total_tenants - active_tenants

        by_plan = {
            row["plan"]: row["count"]
            for row in tenants.values("plan").annotate(count=Count("id"))
        }

        total_users = User.objects.filter(is_superuser=False).count()
        recent_audits = (
            AuditLog.objects.select_related("user", "tenant")
            .order_by("-timestamp")[:15]
        )

        context = {
            **self.each_context(request),
            "title": self.index_title,
            "kpis": {
                "total_tenants": total_tenants,
                "active_tenants": active_tenants,
                "suspended_tenants": suspended_tenants,
                "total_users": total_users,
                "plan_free": by_plan.get("free", 0),
                "plan_pro_retail": by_plan.get("pro_retail", 0),
                "plan_pro_wholesale": by_plan.get("pro_wholesale", 0),
                "plan_enterprise": by_plan.get("enterprise", 0),
            },
            "recent_audits": recent_audits,
            **(extra_context or {}),
        }
        return TemplateResponse(request, "admin/shodz_index.html", context)
