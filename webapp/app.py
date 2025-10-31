"""
Bordercore Web Front-End
========================

Flask front-end that wires together several subsystems:

* **RAG** – Upload, embed, and query documents.
* **Audio** – Speech-to-text (Whisper) and text-to-speech helpers.
* **Vision** – Multimodal image + text chat.
* **Chat**  – General LLM endpoint with optional streaming.

The app renders a minimal HTML/JS single-page UI (``base.html``) and exposes a
set of JSON/streaming routes consumed by that frontend.

Environment
-----------
All run-time configuration comes from ``api.settings``:

    flask_secret_key, music_uri, sensor_uri, sensor_threshold,
    tts_host, tts_voice, …
"""

import base64
import json
import os
# import warnings
from pathlib import Path
from typing import Any, Dict, Iterator

import ffmpeg
import numpy as np
import requests
import sounddevice  # Adding this eliminates an annoying warning
from flask import (Flask, Response, abort, jsonify, render_template, request,
                   session, stream_with_context)
from flask.typing import ResponseReturnValue
from flask_session import Session  # type: ignore[attr-defined]

import settings
from modules.audio import Audio
from modules.chatbot import CONTROL_VALUE, ChatBot
from modules.model_manager import ModelManager
from modules.rag import RAG
from modules.util import get_model_info
from modules.vision import Vision

# warnings.filterwarnings("ignore", message=".*The 'nopython' keyword.*")


NUM_STARS = 10
SENSOR_THRESHOLD_DEFAULT = 100

app = Flask(__name__)
app.debug = True
app.secret_key = settings.flask_secret_key
app.config["SESSION_TYPE"] = "filesystem"
app.config["model_manager"] = ModelManager()
app.config["model_manager"].load(settings.model_name)

Session(app)  # Initialize session management


@app.before_request
def before_request_func() -> None:
    """
    Injects default TTS configuration into the user session before every request.
    """
    session["tts_host"] = settings.tts_host
    session["tts_voice"] = settings.tts_voice


@app.route("/")
def main() -> str:
    """
    Renders the main HTML front-end for the application.

    Returns:
        The rendered HTML for the single-page interface, including session values,
        runtime configuration, and UI constants injected into the Jinja template.
    """
    return render_template(
        "base.html",
        session=dict(session),
        settings={
            "music_uri": settings.music_uri,
            "sensor_uri": settings.sensor_uri,
            "sensor_threshold": getattr(settings, "sensor_threshold", SENSOR_THRESHOLD_DEFAULT)
        },
        num_stars=NUM_STARS,
        control_value=CONTROL_VALUE,
        chat_endpoint="/chat"
    )


@app.route("/rag/upload", methods=["POST"])
def rag_upload() -> Response:
    """
    Uploads a document to the RAG system for future retrieval and querying.

    This endpoint accepts a file upload via a POST request and adds its contents to the
    local vector database used by the Retrieval-Augmented Generation pipeline. The file
    is indexed and assigned a unique SHA-1 checksum, which can later be used to query
    the document via the chat interface.

    Args:
        None explicitly. Expects a `multipart/form-data` request with a file field named "file".

    Returns:
        A JSON response containing a single key "sha1sum" representing the document ID.

    Raises:
        ValueError: If the uploaded file does not include a filename.
    """
    filename = request.files["file"].filename
    if filename is None:
        raise ValueError("Uploaded file must have a filename")
    name: str = filename

    text: bytes = request.files["file"].read()
    chromdb = Path(__file__).resolve().parent.parent / "chromdb"
    rag = RAG(None, chromdb=str(chromdb))
    rag.add_document(text=text, name=name)

    return jsonify(
        {
            "sha1sum": rag.get_sha1sum()
        }
    )


@app.route("/rag/chat", methods=["POST"])
def rag_chat() -> ResponseReturnValue:
    """
    Queries an uploaded document using a Retrieval-Augmented Generation (RAG) model.

    This endpoint accepts a POST request with form parameters identifying a previously uploaded
    document and a message to query. It optionally stores additional parameters such as audio
    settings and model behavior in the session. The request is routed to a language model that
    retrieves relevant context from the indexed document and generates a response.

    Args:
        None explicitly. Relies on `request.form` fields:
            - sha1sum: Identifier of the uploaded document.
            - message: User's query message.
            - model: LLM model name to use for the response.
            - speak: Optional, "true"/"false" to enable TTS.
            - audio_speed: Optional, float indicating speech speed.
            - temperature: Optional, float controlling model randomness.
            - enable_thinking: Optional, "true"/"false" to simulate thinking pauses.

    Returns:
        A string response generated by the model based on the document and query.

    Raises:
        404: If the document identified by `sha1sum` is not found in the RAG index.
    """
    sha1sum: str = request.form["sha1sum"]
    message: str = request.form["message"]
    model_name: str = request.form["model"]
    speak: str = request.form.get("speak", "false")
    audio_speed = float(request.form.get("audio_speed", 1.0))
    temperature = float(request.form.get("temperature", 0.7))
    enable_thinking = request.form.get("enable_thinking", "false").lower() == "true"

    store_params_in_session(speak, audio_speed, temperature, enable_thinking)

    chromdb = Path(__file__).resolve().parent.parent / "chromdb"
    rag = RAG(model_name, chromdb=str(chromdb))

    try:
        rag.get_collection(sha1sum=sha1sum)
    except ValueError:
        abort(404, description="Document not found")

    return rag.query_document(message)


@app.route("/audio/upload/file", methods=["POST"])
def audio_upload_file() -> Response:
    """
    Transcribes an uploaded audio file into text.

    This endpoint accepts a multipart/form-data POST request containing an audio file
    under the field name "file". The audio is passed to a transcription engine which
    returns the transcribed text. This is useful for converting speech recordings into
    written form for downstream processing or analysis.

    Args:
        None explicitly. Expects a `multipart/form-data` request with a file field named "file".

    Returns:
        A JSON response containing a single key "text" with the transcription result.
    """
    audio = Audio()
    audio_data = request.files["file"].read()
    text: str = audio.transcribe(audio_data=audio_data)

    return jsonify(
        {
            "text": text
        }
    )


@app.route("/audio/upload/url", methods=["POST"])
def audio_upload_url() -> Response:
    """
    Downloads and transcribes audio from a remote URL.

    This endpoint accepts a POST request with a form field named "url" pointing to an audio or
    video resource (e.g., a YouTube link). The server downloads the audio, extracts the speech
    as text, and returns both the transcript and base64-encoded audio.

    Args:
        None explicitly. Expects a `application/x-www-form-urlencoded` request with:
            - url: The remote media URL to download and transcribe.

    Returns:
        A JSON response containing:
            - "text": The transcribed text.
            - "title": The filename (without extension) of the downloaded media.
            - "audio": The base64-encoded audio data.

    Raises:
        RuntimeError: If no URL is provided or if transcription fails.
    """
    audio = Audio()
    url: str | None = request.form.get("url", None)

    if url is None:
        raise RuntimeError("No url specified")

    filename = audio.download_audio(url=url)
    text: str = audio.transcribe(filename=filename)

    if filename is None:
        raise RuntimeError("No transcript extracted from Youtube video")

    with open(filename, "rb") as file:
        audio_data: bytes = file.read()
    os.remove(filename)

    return jsonify(
        {
            "text": text,
            "title": Path(filename).stem,
            "audio": base64.b64encode(audio_data).decode("utf-8")
        }
    )


@app.route("/audio/chat", methods=["POST"])
def audio_chat() -> str:
    """
    Generates a response to a transcribed audio message using a language model.

    This endpoint accepts a POST request with a transcript and associated chat message,
    optionally configuring generation parameters such as temperature, audio playback speed,
    and whether to simulate thinking pauses. It uses the specified language model to
    generate a response based on the transcript.

    Args:
        None explicitly. Expects a `application/x-www-form-urlencoded` or `multipart/form-data` request with:
            - message: A JSON-formatted chat message list.
            - transcript: The transcribed user input.
            - model: Name of the language model to use.
            - speak (optional): "true"/"false" to enable speech output.
            - audio_speed (optional): Float controlling TTS playback speed.
            - temperature (optional): Float controlling model creativity.
            - enable_thinking (optional): "true"/"false" to simulate delay.

    Returns:
        A string representing the model-generated reply.
    """
    message = json.loads(request.form["message"])
    transcript = request.form["transcript"]
    model_name: str = request.form["model"]
    speak: str = request.form.get("speak", "false")
    audio_speed = float(request.form.get("audio_speed", 1.0))
    temperature = float(request.form.get("temperature", 0.7))
    enable_thinking = request.form.get("enable_thinking", "false").lower() == "true"

    store_params_in_session(speak, audio_speed, temperature, enable_thinking)

    audio = Audio()
    return audio.query_transcription(model_name, message, transcript)


@app.route("/vision/chat", methods=["POST"])
def audio_vision() -> str:
    """
    Generates a multimodal response from an image-aware language model.

    This endpoint receives chat context and an image reference, then invokes a
    Vision-capable model to produce a response that can incorporate details
    extracted from the image. Optional parameters control speech synthesis
    settings and model creativity, and are persisted in the user session.

    Args:
        None explicitly. Expects a `application/x-www-form-urlencoded`
        or `multipart/form-data` request with fields:
            - message: JSON-encoded chat history.
            - image: Base64 string or URL identifying the image to analyze.
            - model: Name of the Vision model to use.
            - speak (optional): "true"/"false" to enable TTS output.
            - audio_speed (optional): Float multiplier for speech rate.
            - temperature (optional): Float controlling response randomness.
            - enable_thinking (optional): "true"/"false" to simulate delays.

    Returns:
        A string containing the model-generated reply.
    """
    message = json.loads(request.form["message"])
    image = request.form["image"]
    model_name: str = request.form["model"]
    speak: str = request.form.get("speak", "false")
    audio_speed = float(request.form.get("audio_speed", 1.0))
    temperature = float(request.form.get("temperature", 0.7))
    enable_thinking = request.form.get("enable_thinking", "false").lower() == "true"

    store_params_in_session(speak, audio_speed, temperature, enable_thinking)

    vision = Vision(model_name, message, image)
    return vision()


@app.route("/speech2text", methods=["POST"])
def speech2text() -> Response:
    """
    Transcribes raw audio data into text using the speech recognition engine.

    This endpoint accepts a POST request containing an audio file uploaded under
    the field name "audio". It decodes the audio and passes it to the transcription
    engine to extract the spoken input as text.

    Args:
        None explicitly. Expects a `multipart/form-data` request with:
            - audio: The raw audio file to transcribe.

    Returns:
        A JSON response containing:
            - "input": The transcription result as a string.
    """
    audio_data = request.files["audio"].read()
    audio = Audio()
    result = audio.transcribe(audio_data=load_audio(audio_data))

    return jsonify(
        {
            "input": result
        }
    )


# Register any optional Flask Blueprints
try:
    from .local.optional import optional_bp
    app.register_blueprint(optional_bp)
except ModuleNotFoundError:
    pass


def generate_stream(chatbot: ChatBot, message: Any) -> Iterator[str]:
    """
    Streams response chunks produced by the chatbot.

    Args:
        chatbot: A fully-initialised ``ChatBot`` instance that will handle the
            request and generate output.
        message: The incoming chat payload (typically a list of message
            dictionaries with ``role`` and ``content`` keys).

    Yields:
        str: Successive text chunks from the chatbot’s response—suitable for
        wrapping in ``flask.Response(stream_with_context(...))`` for real-time
        streaming to the client.
    """
    try:
        yield from chatbot.dispatch_message(message)
    except Exception as error:
        yield f"An error occurred: {error}"


@app.route("/chat", methods=["POST"])
def chat() -> Response:
    """
    Main chat endpoint for streaming LLM responses.

    Args:
        None (reads POSTed form-data containing message, model name, and options).

    Returns:
        A Flask streaming response that emits text chunks generated by the model
        in real-time.
    """
    message = json.loads(request.form["message"])
    model_name = request.form["model"]
    speak = request.form.get("speak", "false")
    audio_speed = float(request.form.get("audio_speed", 1.0))  # Playback speed
    temperature = float(request.form.get("temperature", 0.7))
    wolfram_alpha = request.form.get("wolfram_alpha", "false").lower() == "true"
    url = request.form.get("url", None)
    enable_thinking = request.form.get("enable_thinking", "false").lower() == "true"

    store_params_in_session(speak, audio_speed, temperature, enable_thinking)

    chatbot = ChatBot(
        model_name=model_name,
        model=app.config["model_manager"].get_model(),
        temperature=temperature,
        wolfram_alpha=wolfram_alpha,
        url=url,
        enable_thinking=enable_thinking
    )
    return Response(stream_with_context(generate_stream(chatbot, message)), mimetype="text/plain")


@app.route("/info")
def info() -> Response:
    """
    Returns metadata for all available local models.

    Returns:
        A JSON response containing model details such as size, type, and other
        attributes.
    """
    model_info = {"name": settings.model_name}
    return jsonify(model_info)


@app.route("/list")
def list_models() -> Response:
    """
    Lists the identifiers of all models available to load.

    Returns:
        A JSON response with a list of model names.
    """
    model_list = ChatBot.get_model_list()
    return jsonify(model_list)


@app.route("/load", methods=["POST"])
def load() -> Response:
    """
    Loads a model into memory if it is not an API-based model.

    Args:
        None (expects form-data containing the model name under the "model" key).

    Returns:
        A JSON response indicating success or failure of the load operation.
    """
    model_name: str = request.form["model"]
    model_type: str | None = ChatBot.get_model_attribute(model_name, "type")

    if model_type == "api":
        response_data: Dict[str, Any] = {"status": "OK"}
    else:
        try:
            manager = app.config["model_manager"]
            manager.unload()
            manager.load(model_name)
            status = "OK"
            message = ""
        except Exception as e:
            status = "Error"
            message = str(e)
        response_data =  {"status": status, "message": message}

    return jsonify(response_data)


# Source: https://github.com/openai/whisper/discussions/380#discussioncomment-3928648
def load_audio(file: str | bytes, sr: int = 16_000) -> np.ndarray:
    """
    Loads an audio file or byte stream into a mono float32 NumPy waveform.

    Args:
        file: Either a file path (str) or raw audio bytes.
        sr: Target sample rate for the audio, in Hz (default is 16,000).

    Returns:
        A NumPy array of float32 samples normalized to the range -1.0 to 1.0.
    """
    if isinstance(file, bytes):
        inp = file
        file = "pipe:"
    else:
        inp = None

    try:
        # This launches a subprocess to decode audio while down-mixing and resampling as necessary.
        # Requires the ffmpeg CLI and `ffmpeg-python` package to be installed.
        out, _ = (
            ffmpeg.input(file, threads=0)
            .output("-", format="s16le", acodec="pcm_s16le", ac=1, ar=sr)
            .run(cmd="ffmpeg", capture_stdout=True, capture_stderr=True, input=inp)
        )
    except ffmpeg.Error as e:
        raise RuntimeError(f"Failed to load audio: {e.stderr.decode()}") from e

    return np.frombuffer(out, np.int16).flatten().astype(np.float32) / 32768.0


def store_params_in_session(
    speak: str, audio_speed: float, temperature: float, enable_thinking: bool
) -> None:
    """
    Stores user preferences in the Flask session for later use.

    Args:
        speak: Whether text responses should be converted to speech.
        audio_speed: Playback speed multiplier for TTS.
        temperature: Sampling temperature used during LLM generation.
        enable_thinking: Whether internal reasoning/debug steps should be enabled.
    """
    session.permanent = True
    session["speak"] = speak.lower() == "true"  # Convert "true" to True, for example
    session["audio_speed"] = audio_speed
    session["temperature"] = temperature
    session["enable_thinking"] = enable_thinking
