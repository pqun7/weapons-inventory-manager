#!/usr/bin/env python3
"""Shared helpers for the Armory Store database maintenance commands."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse


def load_dotenv(path: Path) -> None:
    """Load an env file without overriding variables already set by the shell."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def connection_kwargs() -> dict[str, object]:
    database_url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if database_url:
        return {"conninfo": database_url}

    supabase_url = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or "").strip()
    password = (os.environ.get("DATABASE_PASSWORD") or os.environ.get("SUPABASE_DB_PASSWORD") or "").strip()
    if not supabase_url or not password:
        raise RuntimeError("Set SUPABASE_DB_URL, or SUPABASE_URL and SUPABASE_DB_PASSWORD")
    hostname = urlparse(supabase_url).hostname
    if not hostname or not hostname.endswith(".supabase.co"):
        raise RuntimeError("SUPABASE_URL must be a valid https://PROJECT_REF.supabase.co URL")
    project_ref = hostname.removesuffix(".supabase.co")
    return {
        "host": f"db.{project_ref}.supabase.co",
        "port": 5432,
        "dbname": "postgres",
        "user": "postgres",
        "password": password,
        "sslmode": "require",
    }


def supabase_url() -> str:
    value = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or "").strip().rstrip("/")
    if not value:
        raise RuntimeError("SUPABASE_URL or VITE_SUPABASE_URL is required")
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".supabase.co"):
        raise RuntimeError("Supabase URL must use https://PROJECT_REF.supabase.co")
    return value


def service_role_key() -> str:
    value = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not value:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for Auth administration")
    return value


def auth_admin_request(method: str, path: str, body: dict[str, object] | None = None) -> object:
    """Call the documented Supabase Auth administrator endpoint."""
    key = service_role_key()
    encoded = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        f"{supabase_url()}/auth/v1/admin/{path.lstrip('/')}",
        data=encoded,
        method=method,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read().decode("utf-8")
            return json.loads(payload) if payload else None
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(payload)
        except json.JSONDecodeError:
            detail = {"message": payload or error.reason}
        message = detail.get("msg") or detail.get("message") or detail.get("error_description") or error.reason
        raise RuntimeError(f"Supabase Auth admin request failed ({error.code}): {message}") from error


def create_auth_user(email: str, password: str, display_name: str) -> str:
    response = auth_admin_request("POST", "users", {
        "email": email,
        "password": password,
        "email_confirm": True,
        "user_metadata": {"display_name": display_name},
    })
    if isinstance(response, dict) and isinstance(response.get("user"), dict):
        response = response["user"]
    if not isinstance(response, dict) or not isinstance(response.get("id"), str):
        raise RuntimeError("Supabase Auth returned an invalid user response")
    return response["id"]


def delete_auth_user(user_id: str) -> None:
    auth_admin_request("DELETE", f"users/{user_id}")
