from django.urls import path

from . import views

urlpatterns = [
    path("", views.dashboard, name="dashboard"),
    path("api/devices/", views.devices, name="devices"),
    path("api/readings/", views.readings, name="readings"),
]
