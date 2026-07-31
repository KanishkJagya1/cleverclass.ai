"""LLM providers behind a two-method interface: complete() and stream().

The `echo` provider is not a toy — it lets the entire RAG stack, the SSE
transport and the frontend chat UI be developed and tested before anyone has
provisioned an API key, and it keeps CI free of network calls.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import AsyncIterator, Protocol

from app.config import settings

log = logging.getLogger(__name__)


class LLM(Protocol):
    async def complete(self, system: str, prompt: str) -> str: ...
    def stream(self, system: str, prompt: str) -> AsyncIterator[str]: ...


class EchoLLM:
    """Extractive fallback: returns the most relevant sentences from context.

    Grounded by construction — it cannot hallucinate because it only ever
    repeats retrieved text.
    """

    @staticmethod
    def _summarise(prompt: str) -> str:
        context = ""
        if "CONTEXT:" in prompt and "CONVERSATION SO FAR:" in prompt:
            context = prompt.split("CONTEXT:", 1)[1].split("CONVERSATION SO FAR:", 1)[0]

        question = prompt.split("QUESTION:", 1)[-1].split("\n", 1)[0].strip().lower()
        keywords = {w for w in re.findall(r"\w+", question) if len(w) > 3}

        sentences = [
            s.strip()
            for s in re.split(r"(?<=[.!?])\s+", re.sub(r"\[[^\]]*\]|-{3,}", " ", context))
            if len(s.strip()) > 30
        ]
        if not sentences:
            return "I don't have that information to hand."

        ranked = sorted(
            sentences,
            key=lambda s: len(keywords & set(re.findall(r"\w+", s.lower()))),
            reverse=True,
        )
        return " ".join(ranked[:3])

    async def complete(self, system: str, prompt: str) -> str:
        return self._summarise(prompt)

    async def stream(self, system: str, prompt: str) -> AsyncIterator[str]:
        text = self._summarise(prompt)
        for word in text.split(" "):
            yield word + " "
            # Paced so the frontend's streaming UI is genuinely exercised.
            await asyncio.sleep(0.012)


class OpenAILLM:
    def __init__(self, api_key: str, model: str) -> None:
        from openai import AsyncOpenAI

        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def complete(self, system: str, prompt: str) -> str:
        resp = await self._client.chat.completions.create(
            model=self._model,
            temperature=settings.temperature,
            max_tokens=settings.max_tokens,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        )
        return (resp.choices[0].message.content or "").strip()

    async def stream(self, system: str, prompt: str) -> AsyncIterator[str]:
        stream = await self._client.chat.completions.create(
            model=self._model,
            temperature=settings.temperature,
            max_tokens=settings.max_tokens,
            stream=True,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta


class GeminiLLM:
    def __init__(self, api_key: str, model: str) -> None:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        self._model_name = model
        self._genai = genai

    def _model(self, system: str):
        return self._genai.GenerativeModel(
            self._model_name,
            system_instruction=system,
            generation_config={
                "temperature": settings.temperature,
                "max_output_tokens": settings.max_tokens,
            },
        )

    async def complete(self, system: str, prompt: str) -> str:
        resp = await self._model(system).generate_content_async(prompt)
        return (resp.text or "").strip()

    async def stream(self, system: str, prompt: str) -> AsyncIterator[str]:
        resp = await self._model(system).generate_content_async(prompt, stream=True)
        async for chunk in resp:
            if chunk.text:
                yield chunk.text


def build_llm() -> LLM:
    provider = settings.llm_provider

    if provider == "openai" and settings.openai_api_key:
        log.info("LLM: OpenAI %s", settings.openai_model)
        return OpenAILLM(settings.openai_api_key, settings.openai_model)

    if provider == "gemini" and settings.gemini_api_key:
        log.info("LLM: Gemini %s", settings.gemini_model)
        return GeminiLLM(settings.gemini_api_key, settings.gemini_model)

    if provider != "echo":
        log.warning("LLM provider %r selected but no API key set — using echo.", provider)

    return EchoLLM()
