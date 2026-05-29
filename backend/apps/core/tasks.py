"""Celery tasks for the core app: email notifications."""
from celery import shared_task
from django.core.mail import send_mail
from django.conf import settings


@shared_task(name="core.send_password_reset_email", ignore_result=True)
def send_password_reset_email(user_pk: int, uid: str, token: str):
    from apps.core.models import User
    try:
        user = User.objects.get(pk=user_pk)
    except User.DoesNotExist:
        return

    frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost")
    reset_url = f"{frontend_url}/reset-password?uid={uid}&token={token}"

    send_mail(
        subject="Réinitialisation de votre mot de passe ShoeDZ",
        message=f"""Bonjour {user.first_name or user.email},

Vous avez demandé la réinitialisation de votre mot de passe.

Cliquez sur le lien ci-dessous pour choisir un nouveau mot de passe :
{reset_url}

Ce lien expire dans 24 heures.

Si vous n'avez pas fait cette demande, ignorez cet email.

— L'équipe ShoeDZ""",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=True,
    )


@shared_task(name="core.send_welcome_email", ignore_result=True)
def send_welcome_email(user_pk: int, temp_password: str, tenant_name: str):
    from apps.core.models import User
    try:
        user = User.objects.get(pk=user_pk)
    except User.DoesNotExist:
        return

    frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost")

    send_mail(
        subject=f"Bienvenue sur ShoeDZ — {tenant_name}",
        message=f"""Bonjour {user.first_name or user.email},

Un compte a été créé pour vous sur ShoeDZ ({tenant_name}).

Email    : {user.email}
Mot de passe temporaire : {temp_password}

Connectez-vous ici : {frontend_url}/login

Pensez à changer votre mot de passe après la première connexion.

— L'équipe ShoeDZ""",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=True,
    )
