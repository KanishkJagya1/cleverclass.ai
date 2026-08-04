"""Response models for the catalogue API.

These mirror `frontend/types/catalog.ts` field for field. The frontend parses
every response with zod at the boundary (`lib/data/schemas.ts`), so a drift here
surfaces as one legible error instead of a crash three components deep.

Every route serves these with `response_model_exclude_none=True`. The TS types
mark optional fields with `?`, and a consumer that distinguishes "absent" from
"explicitly null" — which `noUncheckedIndexedAccess` code tends to — should see
the key missing, exactly as the seed adapter produced it.
"""

from __future__ import annotations

from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")

Board = Literal["state", "cbse"]
Medium = Literal["marathi", "semi-english", "english"]
Series = Literal["kohinoor", "spark", "vidyamitra", "winwings", "ekatmik"]
Stream = Literal["science-pcm", "science-pcb", "science-pcbm", "commerce", "arts"]
ProductFormat = Literal["book", "combo", "key-note"]
SortKey = Literal[
    "relevance", "popularity", "rating", "newest", "price-asc", "price-desc"
]


class CoverImageOut(BaseModel):
    src: str
    alt: str
    kind: Literal["front", "back", "inside"]
    width: int
    height: int
    blurDataURL: str | None = None


class BookOut(BaseModel):
    id: str
    slug: str
    title: str
    titleMr: str | None = None
    series: str
    board: str
    classId: str
    medium: str
    subject: str
    stream: str | None = None

    price: int
    mrp: int | None = None

    images: list[CoverImageOut] = Field(default_factory=list)
    # Populated from the PDF + admin free-page ranges, never from a stored list
    # of image paths. An empty list means "no free sample yet", and the product
    # page hides the preview CTA rather than opening a modal of 404s.
    previewPages: list[str] = Field(default_factory=list)

    pages: int
    isbn: str | None = None
    edition: str
    description: str
    highlights: list[str] = Field(default_factory=list)
    rating: float
    reviewCount: int
    inStock: bool
    bestSellerRank: int | None = None
    publishedAt: str
    variants: list[str] | None = None
    related: list[str] | None = None

    # Additive, not in the original TS type. The assistant needs freePageCount
    # to render "Read 18 pages free"; the frontend type gains it as optional.
    freePageCount: int | None = None
    totalPages: int | None = None


class ComboOut(BaseModel):
    id: str
    slug: str
    title: str
    titleMr: str | None = None
    board: str
    classId: str
    medium: str
    stream: str | None = None
    price: int
    mrp: int | None = None
    itemSlugs: list[str] = Field(default_factory=list)
    images: list[CoverImageOut] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list)
    description: str
    rating: float
    reviewCount: int
    inStock: bool
    publishedAt: str


class ComboResolvedOut(ComboOut):
    items: list[BookOut] = Field(default_factory=list)
    itemsTotal: int
    savings: int
    savingsPct: int


class KeyNoteOut(BaseModel):
    id: str
    slug: str
    title: str
    titleMr: str | None = None
    classId: str
    subject: str
    medium: str
    board: str
    chapters: list[str] = Field(default_factory=list)
    previewPages: list[str] = Field(default_factory=list)
    totalPages: int
    relatedBookSlug: str | None = None
    updatedAt: str


class ReviewOut(BaseModel):
    id: str
    productSlug: str
    author: str
    rating: int
    title: str
    body: str
    date: str
    verified: bool


class FacetCountOut(BaseModel):
    value: str
    label: str
    count: int


class PriceRangeOut(BaseModel):
    min: int
    max: int


class FacetsOut(BaseModel):
    classId: list[FacetCountOut] = Field(default_factory=list)
    medium: list[FacetCountOut] = Field(default_factory=list)
    subject: list[FacetCountOut] = Field(default_factory=list)
    series: list[FacetCountOut] = Field(default_factory=list)
    priceRange: PriceRangeOut


class PaginatedOut(BaseModel, Generic[T]):
    items: list[T] = Field(default_factory=list)
    total: int
    page: int
    perPage: int
    totalPages: int


class SearchHitOut(BaseModel):
    slug: str
    title: str
    titleMr: str | None = None
    subtitle: str
    format: ProductFormat
    href: str
    image: str | None = None
    price: int | None = None
    score: float | None = None
    # Added so the assistant can stop guessing. The widget previously hardcoded
    # classId "10" / medium "marathi" on every recommended product, which put
    # the wrong medium in the cart on a business whose top support cost is
    # exactly that. When these are absent the UI must link, not add to cart.
    classId: str | None = None
    medium: str | None = None
    mrp: int | None = None
    previewHref: str | None = None
    freePageCount: int | None = None


class CatalogExportOut(BaseModel):
    """Bulk slug listing for sitemap.ts and build-time static params.

    Exists so `next build` does not fetch 325 pages one at a time, and so the
    sitemap route makes one request instead of one per URL.
    """

    books: list[str] = Field(default_factory=list)
    combos: list[str] = Field(default_factory=list)
    keyNotes: list[str] = Field(default_factory=list)
    generatedAt: str
