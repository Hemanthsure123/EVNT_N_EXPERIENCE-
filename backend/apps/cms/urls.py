"""Mounted under /api/v1/ (see config/urls.py).

`GET /homepage` is public and deliberately short — it is the front page's one
request. Everything else sits under `admin/` alongside the console's routes.
"""

from django.urls import path

from . import api

urlpatterns = [
    path("homepage", api.HomepageView.as_view(), name="homepage"),
    path("admin/homepage", api.HomepageContentView.as_view(), name="admin-homepage"),
    path("admin/homepage/featured", api.FeaturedListView.as_view(), name="admin-featured"),
    path(
        "admin/homepage/featured/reorder",
        api.FeaturedReorderView.as_view(),
        name="admin-featured-reorder",
    ),
    path(
        "admin/homepage/featured/<uuid:entry_id>",
        api.FeaturedDetailView.as_view(),
        name="admin-featured-detail",
    ),
    path("admin/categories", api.CategoryListView.as_view(), name="admin-categories"),
    path(
        "admin/featured-cities",
        api.FeaturedCityListView.as_view(),
        name="admin-featured-cities",
    ),
    path(
        "admin/featured-cities/<uuid:city_id>",
        api.FeaturedCityDetailView.as_view(),
        name="admin-featured-city-detail",
    ),
    path(
        "admin/popular-searches",
        api.PopularSearchListView.as_view(),
        name="admin-popular-searches",
    ),
    path(
        "admin/popular-searches/<uuid:search_id>",
        api.PopularSearchDetailView.as_view(),
        name="admin-popular-search-detail",
    ),
    path(
        "admin/categories/<uuid:category_id>",
        api.CategoryDetailView.as_view(),
        name="admin-category-detail",
    ),
]
