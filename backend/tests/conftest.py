"""Shared test fixtures for the ARROH backend.

An isolated file-backed SQLite database is configured before any ``app`` module is
imported, so tests never touch a developer's local ``arroh_dev.db``.
"""

import os
import tempfile

_TMPDIR = tempfile.mkdtemp(prefix="arroh_test_")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TMPDIR}/test.db"
os.environ["API_ENV"] = "test"

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session")
def client():
    """A FastAPI TestClient whose startup bootstraps the test schema."""
    with TestClient(app) as test_client:
        yield test_client
