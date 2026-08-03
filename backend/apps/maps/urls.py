"""Maps Platform routes, mounted under /api/v1/."""

from __future__ import annotations

from django.urls import path

from . import api

urlpatterns = [
    path("maps/config", api.MapsConfigView.as_view(), name="maps-config"),
    path("maps/places/autocomplete", api.PlaceAutocompleteView.as_view(), name="maps-autocomplete"),
    path("maps/places/search", api.PlaceSearchView.as_view(), name="maps-place-search"),
    path("maps/places/photo", api.PlacePhotoView.as_view(), name="maps-place-photo"),
    # AFTER the literal `places/...` routes above, or `<str:place_id>` would
    # swallow "autocomplete", "search" and "photo" as place ids.
    path("maps/places/<str:place_id>", api.PlaceDetailView.as_view(), name="maps-place-detail"),
    path("maps/geocode", api.GeocodeView.as_view(), name="maps-geocode"),
    path("maps/directions", api.DirectionsView.as_view(), name="maps-directions"),
    path("maps/distance-matrix", api.DistanceMatrixView.as_view(), name="maps-distance-matrix"),
]
