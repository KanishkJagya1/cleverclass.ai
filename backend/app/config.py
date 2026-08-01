"""Application settings, driven entirely by environment variables.

Everything that differs between a laptop, Render and AWS lives here — no
module below reads os.environ directly.
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "CleverClass.AI Assistant"
    environment: Literal["development", "production"] = "development"
    log_level: str = "INFO"

    # --- CORS ---------------------------------------------------------------
    # The frontend proxies through /api/ai/*, so in production the browser
    # never calls this service cross-origin. These entries exist for local
    # development and for anyone hitting the API directly.
    allowed_origins: list[str] = [
        "http://localhost:3000",
        "https://kohinoortez.com",
        "https://www.kohinoortez.com",
    ]

    # Optional shared secret. When set, every request must carry X-API-Key.
    api_key: str | None = None

    # --- LLM ----------------------------------------------------------------
    # "echo" needs no API key and returns a deterministic grounded answer, so
    # the whole stack is runnable and testable before any key exists.
    llm_provider: Literal["openai", "gemini", "echo"] = "echo"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.0-flash"
    temperature: float = 0.2
    max_tokens: int = 700

    # --- Embeddings ---------------------------------------------------------
    # Local sentence-transformers by default: no per-query cost, no network,
    # and 384 dimensions is ample for a corpus this size.
    embedding_provider: Literal["sentence-transformers", "openai"] = "sentence-transformers"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    openai_embedding_model: str = "text-embedding-3-small"

    # --- Vector store -------------------------------------------------------
    vector_store: Literal["chroma", "memory"] = "chroma"
    chroma_path: str = "./vector_db/chroma"
    collection_name: str = "kohinoor_knowledge"
    knowledge_dir: str = "./knowledge"

    # --- Retrieval ----------------------------------------------------------
    chunk_size: int = 900
    chunk_overlap: int = 150
    top_k: int = 5
    # Below this cosine similarity we treat the corpus as having no answer and
    # refuse rather than let the model improvise. Tuned against the seed
    # corpus — re-check it whenever the knowledge base changes materially.
    min_relevance: float = 0.28

    cache_size: int = 256

    # --- Business facts injected into prompts and fallbacks ------------------
    # The platform brand. NOT the book series — "Kohinoor" remains one of the
    # five imprints in the catalogue and must never be renamed.
    company_name: str = "CleverClass.AI"
    company_phone: str = "+91 71042 99010"
    company_email: str = "kohinoortezz@gmail.com"
    free_shipping_threshold: int = 200


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
