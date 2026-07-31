"""Request/response models. These are the API contract with the frontend."""

from typing import Literal

from pydantic import BaseModel, Field


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    # Capped at 6 turns: the frontend sends a rolling window, and this bound
    # is what stops a long conversation from growing the prompt without limit.
    history: list[Turn] = Field(default_factory=list, max_length=6)


class ProductHit(BaseModel):
    """Mirrors the frontend's SearchHit so chat answers can render as cards."""

    slug: str
    title: str
    titleMr: str | None = None
    subtitle: str = ""
    format: Literal["book", "combo", "key-note"] = "book"
    href: str
    image: str | None = None
    price: float | None = None
    score: float | None = None


class Source(BaseModel):
    id: str
    title: str
    score: float


class ChatResponse(BaseModel):
    answer: str
    products: list[ProductHit] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)
    grounded: bool = True


class SearchRequest(BaseModel):
    q: str = Field(min_length=2, max_length=300)
    limit: int = Field(default=8, ge=1, le=30)


class SearchFilters(BaseModel):
    """Structured filters parsed out of a natural-language query (D8).

    The palette applies these as real catalogue facets rather than showing the
    user a paragraph of prose.
    """

    classId: str | None = None
    medium: str | None = None
    subject: str | None = None
    series: str | None = None
    stream: str | None = None


class SearchResponse(BaseModel):
    hits: list[ProductHit] = Field(default_factory=list)
    filters: SearchFilters = Field(default_factory=SearchFilters)
    interpreted: str = ""


class IngestResponse(BaseModel):
    ingested: int
    chunks: int
    collection: str


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    llm_provider: str
    embedding_provider: str
    vector_store: str
    documents: int
