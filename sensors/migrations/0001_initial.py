import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(
            name="SensorDevice",
            fields=[
                ("device_id", models.CharField(max_length=100, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=120)),
                ("gpio_pin", models.PositiveSmallIntegerField(default=27)),
                ("last_seen", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("sound_detected", models.BooleanField(default=False)),
            ],
        ),
        migrations.CreateModel(
            name="SoundReading",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("sound_detected", models.BooleanField()),
                ("received_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("device", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="readings", to="sensors.sensordevice")),
            ],
            options={"ordering": ["-received_at"]},
        ),
        migrations.AddIndex(
            model_name="soundreading",
            index=models.Index(fields=["device", "-received_at"], name="sensors_sou_device__f14e7e_idx"),
        ),
    ]
