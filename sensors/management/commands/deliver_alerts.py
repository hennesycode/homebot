import logging
import os
import time
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import DatabaseError, close_old_connections, transaction
from django.utils import timezone

from sensors.models import WebhookDelivery
from .mqtt_listener import send_hermes_alert

logger = logging.getLogger(__name__)


def deliver_pending(limit=10):
    if not os.getenv("HOMEBOT_HERMES_WEBHOOK_URL") or not os.getenv("HOMEBOT_HERMES_WEBHOOK_SECRET"):
        return 0
    count = 0
    for _ in range(limit):
        now = timezone.now()
        with transaction.atomic():
            delivery = (WebhookDelivery.objects.select_for_update().filter(
                delivered_at__isnull=True, next_attempt_at__lte=now).order_by("next_attempt_at", "created_at").first())
            if not delivery:
                break
            delivery.attempts += 1
            # Lease survives process crashes, preventing permanent "in progress" messages.
            delivery.next_attempt_at = now + timedelta(seconds=30)
            delivery.save(update_fields=["attempts", "next_attempt_at"])
        success = send_hermes_alert(delivery.payload, request_id=delivery.pk)
        if success:
            WebhookDelivery.objects.filter(pk=delivery.pk).update(delivered_at=timezone.now(), last_error="")
            count += 1
        else:
            delay = min(300, 5 * 2 ** min(delivery.attempts, 6))
            WebhookDelivery.objects.filter(pk=delivery.pk).update(
                last_error="HTTP delivery failed", next_attempt_at=timezone.now()+timedelta(seconds=delay))
    return count


class Command(BaseCommand):
    help = "Delivers persisted sensor webhooks with stable IDs and bounded backoff."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")

    def handle(self, *args, **options):
        last_notice = 0
        last_cleanup = 0
        while True:
            try:
                close_old_connections()
                if time.monotonic()-last_notice > 60:
                    if not os.getenv("HOMEBOT_HERMES_WEBHOOK_URL") or not os.getenv("HOMEBOT_HERMES_WEBHOOK_SECRET"):
                        logger.warning("Webhook configuration missing; queued messages remain pending")
                    last_notice = time.monotonic()
                delivered = deliver_pending()
                if delivered:
                    self.stdout.write(f"HTTP acknowledged: {delivered} sensor messages")
                if time.monotonic()-last_cleanup > 3600:
                    WebhookDelivery.objects.filter(delivered_at__lt=timezone.now()-timedelta(days=7)).delete()
                    last_cleanup = time.monotonic()
            except DatabaseError:
                logger.exception("Webhook queue database unavailable; will retry")
            finally:
                close_old_connections()
            if options["once"]:
                return
            time.sleep(1)
