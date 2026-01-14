from pathlib import Path

from webapp.app import app

BASE_DIR = Path(__file__).resolve().parent
SSL_CERT = BASE_DIR / "ssl" / "server.crt"
SSL_KEY = BASE_DIR / "ssl" / "server.key"


if __name__ == "__main__":
    if SSL_CERT.exists() and SSL_KEY.exists():
        app.run(host="0.0.0.0", port=5010, ssl_context=(str(SSL_CERT), str(SSL_KEY)))
    else:
        app.run(host="0.0.0.0", port=5010, ssl_context="adhoc", use_reloader=False)
