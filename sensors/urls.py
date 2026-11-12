from django.urls import path

from . import lab_views, views

urlpatterns = [
    path("api/lab/", lab_views.state, name="lab-state"),
    path("api/lab/servo/", lab_views.servo, name="lab-servo"),
    path("", views.dashboard, name="dashboard"),
    path("api/devices/", views.devices, name="devices"),
    path("api/readings/", views.readings, name="readings"),
]
