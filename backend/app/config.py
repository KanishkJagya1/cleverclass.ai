"""Application settings, driven entirely by environment variables.

Everything that differs between a laptop, Render and AWS lives here — no
module below reads os.environ directly.
"""

import json
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


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
    # `NoDecode` is load-bearing, not decoration.
    #
    # pydantic-settings JSON-decodes complex types INSIDE its env source, before
    # any field_validator runs. So a plain `ALLOWED_ORIGINS=http://host:8050`
    # raised `SettingsError: error parsing value for field "allowed_origins"`
    # at import time and the container never started — the validator below was
    # never reached. NoDecode hands the raw string over untouched and lets that
    # validator accept both a JSON array and a comma-separated list.
    allowed_origins: Annotated[list[str], NoDecode] = [
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
    # This budget covers THINKING TOKENS TOO, and on gemini-flash-latest thinking
    # is on by default and is not small: a 15-token question spent 438 tokens
    # thinking, measured against the live key. At 700 that left ~40 tokens of
    # visible text, so the assistant replied "…the price is not listed in my
    # records, so" — cut mid-sentence, with nothing logged. Raised so thinking
    # and a three-sentence answer both fit.
    max_tokens: int = 2048
    # Hint, not a hard cap — asking for 128 still spent 250. Still worth setting:
    # it roughly halves thinking, which is latency the customer waits through.
    # MUST NOT be 0: current flash models reject `thinkingBudget: 0` with
    # HTTP 400 "Request contains an invalid argument". 0 here means "omit".
    thinking_budget: int = 128

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
    # Where support tickets are emailed. Separate from `company_email` so the
    # inbox a customer writes to and the one staff watch can diverge later
    # without touching every template; defaults to the same address.
    support_email: str | None = None
    company_whatsapp: str = "917104299010"  # digits only, for wa.me links
    free_shipping_threshold: int = 200
    shipping_flat_rate: int = 40

    # --- Manual payment (no gateway yet) -------------------------------------
    # Where customers send money until a gateway is integrated. Settings rather
    # than hardcoded so the owner can change bank details without a deploy —
    # and empty by default, because shipping someone else's placeholder UPI id
    # would send real money to a stranger.
    payment_upi_id: str = ""
    payment_account_name: str = ""

    # --- Razorpay ------------------------------------------------------------
    # Dashboard → Settings → API Keys. Test keys start `rzp_test_`, live ones
    # `rzp_live_` — the code does not care, but you will when a real card is
    # charged, so the active mode is reported by /health.
    #
    # The provider stays inert until BOTH are set: `payment_provider` falls back
    # to manual, so a half-configured deployment takes bank transfers instead of
    # showing customers a checkout that cannot complete.
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    # Dashboard → Settings → Webhooks. Different from the key secret, and the
    # webhook is what makes payment status reliable when a customer closes the
    # tab before the browser callback fires.
    razorpay_webhook_secret: str = ""

    # "auto" uses Razorpay when configured and manual otherwise. Force with
    # "manual" or "razorpay" when testing.
    payment_provider: Literal["auto", "manual", "razorpay"] = "auto"

    # --- Invoicing / GST -----------------------------------------------------
    # `seller_state` decides CGST+SGST versus IGST, so it must match the state
    # on the GST registration. Blank GSTIN simply omits it from the invoice,
    # which is correct for a business below the registration threshold.
    invoice_prefix: str = "CC"
    seller_gstin: str = ""
    seller_state: str = "Maharashtra"

    # --- Database -----------------------------------------------------------
    db_path: str = "./data/cleverclass.db"

    # --- Media (PDFs, rendered preview pages, covers) -----------------------
    # Bind-mounted in production. PDFs live under here but are NEVER inside an
    # nginx root — the only way to see a page is through the preview API, which
    # checks the free-page ranges first.
    media_root: str = "./data/media"
    max_pdf_mb: int = 200
    preview_dpi: int = 144
    preview_quality: int = 78
    # Refuse a free-page spec covering more than this fraction of a book unless
    # explicitly forced. Fat-fingering "1-200" and giving away a whole title is
    # a real commercial risk, and this is one comparison to prevent it.
    max_free_fraction: float = 0.25

    # --- Email (stdlib smtplib; no paid API) ---------------------------------
    # Everything auth-related works with these unset: mail is written to
    # `email_outbox` as `skipped` and logged loudly, rather than disappearing.
    #
    # GMAIL SETUP (the intended configuration):
    #   SMTP_HOST=smtp.gmail.com
    #   SMTP_PORT=587
    #   SMTP_USER=you@gmail.com
    #   SMTP_PASSWORD=<16-character App Password, NOT the account password>
    #   SMTP_FROM=CleverClass.AI <you@gmail.com>
    #
    # ⚠ Gmail rejects a normal account password over SMTP. You need an **App
    # Password** (Google Account → Security → 2-Step Verification → App
    # passwords), which requires 2FA to be switched on first. "Less secure app
    # access" no longer exists — it was removed by Google in 2022, so an App
    # Password is the only way this works.
    #
    # ⚠ Gmail also caps sending at roughly 500 messages/day on a free account.
    # Fine for order confirmations at this volume; it is the ceiling to watch
    # if newsletters are ever sent through the same mailbox.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None          # "CleverClass.AI <you@gmail.com>"
    smtp_use_tls: bool = True             # STARTTLS on 587
    smtp_use_ssl: bool = False            # implicit TLS on 465

    # --- Google OAuth --------------------------------------------------------
    # The "Continue with Google" button is hidden unless both are set, so an
    # unconfigured deployment shows a working email/password form rather than a
    # button that dead-ends.
    google_client_id: str | None = None
    google_client_secret: str | None = None

    # Public base URL, used to build email links and the OAuth redirect_uri.
    # It MUST match the origin the customer is actually on, or Google rejects
    # the callback and verification links point at the wrong host.
    public_base_url: str = "http://34.131.254.234:8050"

    # --- Admin --------------------------------------------------------------
    admin_session_secret: str | None = None
    admin_session_hours: int = 12
    # Must be False over plain HTTP or the browser will not send the cookie at
    # all. Flip to True the moment TLS is in front of this service.
    cookie_secure: bool = False

    # --- Frontend cache invalidation ----------------------------------------
    # Without this, an admin price edit takes `revalidate = 43200` (12 hours) to
    # appear on the storefront, staff assume the save failed, and they save again.
    frontend_revalidate_url: str | None = None
    frontend_revalidate_secret: str | None = None

    # --- Rate limits (requests per window, per IP) ---------------------------
    chat_rpm: int = 15
    chat_rph: int = 150
    catalog_rpm: int = 120
    preview_rpm: int = 120
    order_rph: int = 5
    login_per_15min: int = 10

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _parse_origins(cls, value):
        """Accept both a JSON array and a comma-separated string.

        The shipped .env.example commented "Comma-separated" above a JSON array
        value; following the comment produced a hard SettingsError at boot. Both
        forms now work, so neither reading of the file is wrong.
        """
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                return json.loads(text)
            return [part.strip() for part in text.split(",") if part.strip()]
        return value

    @model_validator(mode="after")
    def _check_chunking(self):
        """Fail at boot, not at request time.

        `_hard_split` advances with `start = end - overlap`; when overlap >= size
        the cursor never moves, the list grows without bound, and the container
        gets OOM-killed — taking the memory headroom of everything else on the
        box with it.
        """
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError(
                f"chunk_overlap ({self.chunk_overlap}) must be smaller than "
                f"chunk_size ({self.chunk_size}) — equal or greater loops forever"
            )
        if not 0 < self.max_free_fraction <= 1:
            raise ValueError("max_free_fraction must be in (0, 1]")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
