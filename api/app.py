from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3, os

app = Flask(__name__)
CORS(app)

DB = os.path.join(os.path.dirname(__file__), "ratings.db")

def get_db():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    return con

def init_db():
    with get_db() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS votes (
                song_key  TEXT NOT NULL,
                user_id   TEXT NOT NULL,
                vote      TEXT NOT NULL CHECK(vote IN ('up','down')),
                PRIMARY KEY (song_key, user_id)
            );
        """)

init_db()


@app.route("/ratings/<path:song_key>", methods=["GET"])
def get_ratings(song_key):
    """Return total up/down counts and the requesting user's vote (if any)."""
    user_id = request.args.get("uid", "")
    with get_db() as con:
        row = con.execute(
            "SELECT vote FROM votes WHERE song_key=? AND user_id=?",
            (song_key, user_id)
        ).fetchone()
        totals = con.execute(
            "SELECT vote, COUNT(*) as n FROM votes WHERE song_key=? GROUP BY vote",
            (song_key,)
        ).fetchall()

    counts = {"up": 0, "down": 0}
    for t in totals:
        counts[t["vote"]] = t["n"]

    return jsonify({
        "up":        counts["up"],
        "down":      counts["down"],
        "user_vote": row["vote"] if row else None
    })


@app.route("/ratings/<path:song_key>", methods=["POST"])
def cast_vote(song_key):
    """Cast or change a vote. Body: { uid, vote }"""
    body    = request.get_json(force=True)
    user_id = body.get("uid", "").strip()
    vote    = body.get("vote", "").strip()

    if not user_id or vote not in ("up", "down"):
        return jsonify({"error": "invalid payload"}), 400

    with get_db() as con:
        existing = con.execute(
            "SELECT vote FROM votes WHERE song_key=? AND user_id=?",
            (song_key, user_id)
        ).fetchone()

        if existing and existing["vote"] == vote:
            # Same vote again — no-op, just return current totals
            pass
        elif existing:
            con.execute(
                "UPDATE votes SET vote=? WHERE song_key=? AND user_id=?",
                (vote, song_key, user_id)
            )
        else:
            con.execute(
                "INSERT INTO votes (song_key, user_id, vote) VALUES (?,?,?)",
                (song_key, user_id, vote)
            )

        totals = con.execute(
            "SELECT vote, COUNT(*) as n FROM votes WHERE song_key=? GROUP BY vote",
            (song_key,)
        ).fetchall()

    counts = {"up": 0, "down": 0}
    for t in totals:
        counts[t["vote"]] = t["n"]

    return jsonify({
        "up":        counts["up"],
        "down":      counts["down"],
        "user_vote": vote
    })


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
