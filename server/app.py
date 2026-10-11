# -*- coding: utf-8 -*-
"""GAPS API：存测评结果 + 可选转发 Kimi 生成个性化建议。Key 只读环境变量。"""

import json
import os
import re
import sqlite3
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "127.0.0.1"
PORT = 8001
DB_PATH = Path(__file__).resolve().parent / "results.db"

MOONSHOT_API_KEY = os.environ.get("MOONSHOT_API_KEY", "").strip()
MOONSHOT_BASE_URL = os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1").rstrip("/")
MOONSHOT_MODEL = os.environ.get("MOONSHOT_MODEL", "moonshot-v1-8k").strip()

# 本地 5500 静态预览跨域；生产请用 Nginx 同域反代，不依赖这里
LOCAL_CORS_ORIGINS = {
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:5501",
    "http://localhost:5501",
}

# 同一 IP 60 秒内最多请求次数
RATE_WINDOW = 60
RATE_MAX = 20
_hits = {}

ADVICE_SYSTEM = """你是一位温和的升学学长/老师，给初高中生写个性化建议。
根据学生的主类型、最该补的一块、年级和兴趣，生成两段中文：
1) direction：适合方向（专业举例、文理学院或综合大学倾向、国家/地区），2～4 句口语完整话。
2) gapAdvice：可以这样补——先给一个本周能做的小行动，再写清坚持几周后的具体好处（日常/文书/面试），2～4 句。
要求：像朋友娓娓道来；不要写「结合你提到的」「【】」或给兴趣加书名号；不点具体校名；不当扣分；不要分数。
只输出一个 JSON 对象，不要 markdown，格式严格为：
{"direction":"...","gapAdvice":"..."}"""


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            type_id TEXT NOT NULL,
            type_name TEXT NOT NULL,
            totals TEXT NOT NULL,
            gaps TEXT NOT NULL,
            percents TEXT NOT NULL,
            profile TEXT
        )
        """
    )
    cols = [row[1] for row in conn.execute("PRAGMA table_info(results)")]
    if "profile" not in cols:
        conn.execute("ALTER TABLE results ADD COLUMN profile TEXT")
    conn.commit()
    return conn


def client_ip(handler):
    forwarded = handler.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return handler.client_address[0]


def allow(ip):
    now = time.time()
    stamps = [t for t in _hits.get(ip, []) if now - t < RATE_WINDOW]
    if len(stamps) >= RATE_MAX:
        _hits[ip] = stamps
        return False
    stamps.append(now)
    _hits[ip] = stamps
    return True


def extract_json_obj(text):
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        pass
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except ValueError:
        return None


def call_kimi_advice(payload):
    if not MOONSHOT_API_KEY:
        return None, "missing_api_key"

    profile = payload.get("profile") or {}
    user_msg = (
        "主类型：%s（%s）\n"
        "最该补：%s（%s）\n"
        "年级：%s\n"
        "性别：%s\n"
        "兴趣爱好/擅长：%s\n"
        "请生成 direction 与 gapAdvice。"
        % (
            str(payload.get("typeName") or "")[:64],
            str(payload.get("typeId") or "")[:32],
            str(payload.get("gapName") or "")[:64],
            str(payload.get("gapId") or "")[:32],
            str(profile.get("grade") or "")[:16],
            str(profile.get("gender") or "")[:16],
            str(profile.get("interest") or "")[:200],
        )
    )

    body = {
        "model": MOONSHOT_MODEL,
        "temperature": 0.7,
        "messages": [
            {"role": "system", "content": ADVICE_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
    }
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        MOONSHOT_BASE_URL + "/chat/completions",
        data=data,
        headers={
            "Authorization": "Bearer " + MOONSHOT_API_KEY,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        try:
            detail = err.read().decode("utf-8", errors="ignore")[:200]
        except Exception:
            detail = ""
        return None, "kimi_http_%s %s" % (err.code, detail)
    except Exception as err:
        return None, "kimi_error"

    try:
        parsed = json.loads(raw)
        content = parsed["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, ValueError):
        return None, "bad_kimi_response"

    obj = extract_json_obj(content)
    if not obj:
        return None, "bad_json"
    direction = str(obj.get("direction") or "").strip()
    gap_advice = str(obj.get("gapAdvice") or "").strip()
    if not direction or not gap_advice:
        return None, "empty_fields"
    return {"direction": direction[:1200], "gapAdvice": gap_advice[:1200]}, None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def _cors(self):
        origin = (self.headers.get("Origin") or "").strip()
        if origin not in LOCAL_CORS_ORIGINS:
            return
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send(self, code, payload, content_type="application/json; charset=utf-8"):
        body = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self._send(
                200,
                {
                    "ok": True,
                    "kimiConfigured": bool(MOONSHOT_API_KEY),
                    "model": MOONSHOT_MODEL if MOONSHOT_API_KEY else None,
                },
            )
            return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in ("/api/results", "/api/advice"):
            self._send(404, {"ok": False, "error": "not found"})
            return

        ip = client_ip(self)
        if not allow(ip):
            self._send(429, {"ok": False, "error": "too many requests"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 12000:
            self._send(400, {"ok": False, "error": "bad body"})
            return

        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send(400, {"ok": False, "error": "invalid json"})
            return

        if path == "/api/advice":
            self._handle_advice(data)
            return
        self._handle_results(data)

    def _handle_advice(self, data):
        type_id = str(data.get("typeId") or "")[:32]
        type_name = str(data.get("typeName") or "")[:64]
        if not type_id or not type_name:
            self._send(400, {"ok": False, "error": "missing type"})
            return
        if not MOONSHOT_API_KEY:
            self._send(503, {"ok": False, "error": "missing_api_key"})
            return

        result, err = call_kimi_advice(data)
        if err:
            code = 503 if err == "missing_api_key" else 502
            self._send(code, {"ok": False, "error": err})
            return
        self._send(200, {"ok": True, "direction": result["direction"], "gapAdvice": result["gapAdvice"]})

    def _handle_results(self, data):
        type_id = str(data.get("typeId") or "")[:32]
        type_name = str(data.get("typeName") or "")[:64]
        if not type_id or not type_name:
            self._send(400, {"ok": False, "error": "missing type"})
            return

        created = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        profile = data.get("profile") or {}
        conn = db()
        conn.execute(
            "INSERT INTO results (created_at, type_id, type_name, totals, gaps, percents, profile) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                created,
                type_id,
                type_name,
                json.dumps(data.get("totals") or {}, ensure_ascii=False),
                json.dumps(data.get("gaps") or {}, ensure_ascii=False),
                json.dumps(data.get("percents") or {}, ensure_ascii=False),
                json.dumps(profile, ensure_ascii=False)[:1200],
            ),
        )
        conn.commit()
        conn.close()
        self._send(201, {"ok": True})


if __name__ == "__main__":
    db().close()
    print(
        "GAPS API http://%s:%s  (POST /api/results, POST /api/advice, GET /api/health)"
        % (HOST, PORT)
    )
    if MOONSHOT_API_KEY:
        print("Kimi: configured  model=%s  base=%s" % (MOONSHOT_MODEL, MOONSHOT_BASE_URL))
    else:
        print("Kimi: MOONSHOT_API_KEY not set — /api/advice will return 503, frontend uses local copy")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
