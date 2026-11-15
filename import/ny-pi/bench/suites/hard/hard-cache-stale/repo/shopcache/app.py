"""Composição dos serviços."""

from dataclasses import dataclass

from shopcache.cache import make_cache
from shopcache.events import handlers
from shopcache.events.bus import Bus
from shopcache.repo.memory_db import Db
from shopcache.repo.orders import OrderRepo
from shopcache.repo.products import ProductRepo
from shopcache.repo.tenants import TenantRepo
from shopcache.services.catalog import CatalogService
from shopcache.services.orders import OrderService
from shopcache.services.pricing import PricingService
from shopcache.util.clock import ManualClock


@dataclass
class App:
    clock: ManualClock
    cache: object
    products: ProductRepo
    tenants: TenantRepo
    orders: OrderRepo
    pricing: PricingService
    catalog: CatalogService
    order_service: OrderService


def build_app(max_entries: int = 1000, ttl: int = 300) -> App:
    clock, db, bus = ManualClock(), Db(), Bus()
    cache = make_cache(clock, max_entries=max_entries, ttl=ttl)
    handlers.register(bus, cache)
    products, tenants, orders = ProductRepo(db), TenantRepo(), OrderRepo(db)
    pricing = PricingService(products, tenants, cache, bus)
    return App(
        clock,
        cache,
        products,
        tenants,
        orders,
        pricing,
        CatalogService(products, cache, bus),
        OrderService(orders, pricing),
    )
