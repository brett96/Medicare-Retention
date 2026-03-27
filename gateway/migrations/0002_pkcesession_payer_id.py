from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("gateway", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="pkcesession",
            name="payer_id",
            field=models.CharField(default="elevance", max_length=32),
        ),
    ]
