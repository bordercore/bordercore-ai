from pathlib import Path

from tts.app_kokoro import app


BASE_DIR = Path(__file__).resolve().parent
SSL_CERT = BASE_DIR / "ssl" / "server.crt"
SSL_KEY = BASE_DIR / "ssl" / "server.key"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, ssl_context=(str(SSL_CERT), str(SSL_KEY)))
