from __future__ import annotations

import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class Voice:
    id: str
    name: str
    lang: str
    type: str


class TTSUnavailableError(Exception):
    pass


class SpeechError(Exception):
    pass


class TTSService:
    def __init__(self) -> None:
        self._backends: List[BaseBackend] = []
        pico = PicoBackend.detect()
        if pico:
            self._backends.append(pico)
        espeak = EspeakBackend.detect()
        if espeak:
            self._backends.append(espeak)
        if not self._backends:
            logger.warning("No TTS backend available. Install pico2wave or espeak-ng")

    def voices(self) -> List[Dict[str, str]]:
        voices: List[Dict[str, str]] = []
        for backend in self._backends:
            try:
                voices.extend([voice.__dict__ for voice in backend.list_voices()])
            except Exception as exc:  # pragma: no cover - defensive
                logger.error("Failed to list voices for backend %s: %s", backend.name, exc)
        if voices:
            return voices
        raise TTSUnavailableError("No hay motores TTS disponibles")

    def speak(self, voice_id: str, text: str, volume: float = 1.0) -> None:
        if not text:
            raise SpeechError("Texto requerido")
        for backend in self._backends:
            if backend.has_voice(voice_id):
                backend.speak(voice_id, text, volume)
                return
        if self._backends:
            # fallback to first backend default voice
            first = self._backends[0]
            target_voice = voice_id if first.has_voice(voice_id) else first.default_voice()
            first.speak(target_voice, text, volume)
            return
        raise TTSUnavailableError("No hay motores TTS disponibles")


class BaseBackend:
    name = "base"

    def list_voices(self) -> List[Voice]:
        raise NotImplementedError

    def has_voice(self, voice_id: str) -> bool:
        return any(voice.id == voice_id for voice in self.list_voices())

    def speak(self, voice_id: str, text: str, volume: float) -> None:
        raise NotImplementedError

    def default_voice(self) -> str:
        voices = self.list_voices()
        if not voices:
            raise TTSUnavailableError("No voices available")
        return voices[0].id


class PicoBackend(BaseBackend):
    name = "pico2wave"

    def __init__(self, binary: str, player: str) -> None:
        self.binary = binary
        self.player = player
        self._voices = [
            Voice("pico-es", "Pico Spanish", "es-ES", "local"),
            Voice("pico-en", "Pico English", "en-US", "local"),
            Voice("pico-fr", "Pico French", "fr-FR", "local"),
            Voice("pico-it", "Pico Italian", "it-IT", "local"),
            Voice("pico-de", "Pico German", "de-DE", "local"),
        ]

    @classmethod
    def detect(cls) -> Optional["PicoBackend"]:
        binary = shutil.which("pico2wave")
        player = shutil.which("aplay") or shutil.which("paplay") or shutil.which("mpv")
        if binary and player:
            return cls(binary, player)
        return None

    def list_voices(self) -> List[Voice]:
        return self._voices

    def has_voice(self, voice_id: str) -> bool:
        return any(v.id == voice_id for v in self._voices)

    def speak(self, voice_id: str, text: str, volume: float) -> None:
        mapping = {
            "pico-es": "es-ES",
            "pico-en": "en-US",
            "pico-fr": "fr-FR",
            "pico-it": "it-IT",
            "pico-de": "de-DE",
        }
        lang = mapping.get(voice_id, "es-ES")
        with NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            subprocess.run([self.binary, "-l", lang, "-w", tmp_path, text], check=True)
            play_cmd = [self.player, tmp_path]
            if self.player.endswith("mpv"):
                play_cmd = [self.player, "--really-quiet", tmp_path]
            subprocess.run(play_cmd, check=True)
        except subprocess.CalledProcessError as exc:
            logger.error("pico2wave playback failed: %s", exc)
            raise SpeechError("No se pudo reproducir la voz") from exc
        finally:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass


class EspeakBackend(BaseBackend):
    name = "espeak-ng"

    def __init__(self, binary: str) -> None:
        self.binary = binary
        self._voices_cache: Optional[List[Voice]] = None

    @classmethod
    def detect(cls) -> Optional["EspeakBackend"]:
        binary = shutil.which("espeak-ng") or shutil.which("espeak")
        if binary:
            return cls(binary)
        return None

    def list_voices(self) -> List[Voice]:
        if self._voices_cache is not None:
            return self._voices_cache
        result = subprocess.run([self.binary, "--voices"], capture_output=True, text=True, check=False)
        if result.returncode != 0:
            logger.error("espeak-ng --voices failed: %s", result.stderr.strip())
            raise SpeechError("No se pudieron listar las voces")
        voices: List[Voice] = []
        for line in result.stdout.splitlines()[1:]:  # skip header
            parts = line.split()
            if len(parts) < 4:
                continue
            lang = parts[1]
            voice_id = parts[3]
            name = " ".join(parts[3:])
            voices.append(Voice(f"espeak-{voice_id}", name, lang, "local"))
        self._voices_cache = voices
        return voices

    def speak(self, voice_id: str, text: str, volume: float) -> None:
        amplitude = max(0, min(200, int(volume * 200))) if volume is not None else 150
        voice = voice_id.replace("espeak-", "") if voice_id else None
        cmd = [self.binary]
        if voice:
            cmd.extend(["-v", voice])
        cmd.extend(["-a", str(amplitude), text])
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            logger.error("espeak-ng speak failed: %s", result.stderr.strip())
            raise SpeechError(result.stderr.strip() or "No se pudo reproducir la voz")


