"""
Backend unit tests for the Radio Calico ratings API.
Run from project root: uv run --directory api pytest ../tests/test_api.py -v
"""
import pytest
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import app as flask_app


@pytest.fixture
def client(tmp_path):
    """Fresh in-memory test client with an isolated DB for each test."""
    flask_app.DB = str(tmp_path / "test.db")
    flask_app.init_db()
    flask_app.app.config["TESTING"] = True
    with flask_app.app.test_client() as c:
        yield c


# ── GET /ratings/<key> ────────────────────────────────────────────────────────

class TestGetRatings:
    def test_returns_zeros_for_unknown_song(self, client):
        res = client.get("/ratings/unknown_song?uid=user1")
        assert res.status_code == 200
        data = res.get_json()
        assert data["up"] == 0
        assert data["down"] == 0
        assert data["user_vote"] is None

    def test_user_vote_is_none_when_not_voted(self, client):
        res = client.get("/ratings/song1?uid=user1")
        assert res.get_json()["user_vote"] is None

    def test_reflects_existing_vote(self, client):
        client.post("/ratings/song1", json={"uid": "user1", "vote": "up"})
        res = client.get("/ratings/song1?uid=user1")
        data = res.get_json()
        assert data["user_vote"] == "up"
        assert data["up"] == 1

    def test_other_user_sees_no_personal_vote(self, client):
        client.post("/ratings/song1", json={"uid": "user1", "vote": "up"})
        res = client.get("/ratings/song1?uid=user2")
        assert res.get_json()["user_vote"] is None


# ── POST /ratings/<key> ───────────────────────────────────────────────────────

class TestCastVote:
    def test_cast_up_vote(self, client):
        res = client.post("/ratings/song1", json={"uid": "user1", "vote": "up"})
        assert res.status_code == 200
        data = res.get_json()
        assert data["up"] == 1
        assert data["down"] == 0
        assert data["user_vote"] == "up"

    def test_cast_down_vote(self, client):
        res = client.post("/ratings/song1", json={"uid": "user1", "vote": "down"})
        data = res.get_json()
        assert data["down"] == 1
        assert data["up"] == 0

    def test_multiple_users_accumulate(self, client):
        client.post("/ratings/song1", json={"uid": "user1", "vote": "up"})
        client.post("/ratings/song1", json={"uid": "user2", "vote": "up"})
        client.post("/ratings/song1", json={"uid": "user3", "vote": "down"})
        res = client.get("/ratings/song1?uid=user1")
        data = res.get_json()
        assert data["up"] == 2
        assert data["down"] == 1

    def test_same_vote_twice_is_noop(self, client):
        client.post("/ratings/song1", json={"uid": "user1", "vote": "up"})
        client.post("/ratings/song1", json={"uid": "user1", "vote": "up"})
        res = client.get("/ratings/song1?uid=user1")
        assert res.get_json()["up"] == 1

    def test_changing_vote_adjusts_counts(self, client):
        client.post("/ratings/song1", json={"uid": "user1", "vote": "up"})
        client.post("/ratings/song1", json={"uid": "user1", "vote": "down"})
        res = client.get("/ratings/song1?uid=user1")
        data = res.get_json()
        assert data["up"] == 0
        assert data["down"] == 1
        assert data["user_vote"] == "down"

    def test_invalid_vote_value_returns_400(self, client):
        res = client.post("/ratings/song1", json={"uid": "user1", "vote": "meh"})
        assert res.status_code == 400

    def test_missing_uid_returns_400(self, client):
        res = client.post("/ratings/song1", json={"vote": "up"})
        assert res.status_code == 400

    def test_empty_uid_returns_400(self, client):
        res = client.post("/ratings/song1", json={"uid": "", "vote": "up"})
        assert res.status_code == 400

    def test_different_songs_are_independent(self, client):
        client.post("/ratings/song1", json={"uid": "user1", "vote": "up"})
        client.post("/ratings/song2", json={"uid": "user1", "vote": "down"})
        s1 = client.get("/ratings/song1?uid=user1").get_json()
        s2 = client.get("/ratings/song2?uid=user1").get_json()
        assert s1["up"] == 1 and s1["down"] == 0
        assert s2["up"] == 0 and s2["down"] == 1
