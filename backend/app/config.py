from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # extra="ignore" -- backend/.env also carries Spec Builder's own vars
    # (AIPM_MODEL, ANTHROPIC_API_KEY, JIRA_*), which app/spec_builder/main.py
    # reads directly via os.environ (python-dotenv), not through this model.
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    # Which LLMProvider app/llm_client.py hands back to every call site in
    # the backend -- "openai" (default) or "corporate" (see
    # CorporateLLMProvider's docstring in app/llm_client.py before flipping
    # this; it's an unimplemented stub until your endpoint details are filled in).
    llm_provider: str = "openai"
    corporate_llm_base_url: str = ""
    corporate_llm_api_key: str = ""
    corporate_llm_model: str = ""
    # Both localhost and 127.0.0.1 -- browsers treat them as different
    # origins for CORS, and this middleware wraps the whole app, including
    # the /pm mount (app/spec_builder/main.py), so it has to cover whichever
    # one the frontend actually loaded from.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # DEBUG, INFO, WARNING, ERROR -- see app/logging_config.py. INFO is
    # enough to see every Knowledge Base step (upload/replace/delete,
    # chunking, embedding, search); DEBUG also unmutes httpx/openai/
    # chromadb's own request-level logs.
    log_level: str = "INFO"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
