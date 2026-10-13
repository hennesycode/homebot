from django.urls import include, path

urlpatterns = [path("", include("sensors.urls"))]
