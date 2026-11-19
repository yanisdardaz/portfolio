"""Génère les images de QR codes utilisées par les tests (python make_qr.py)."""
from pathlib import Path

import qrcode

HERE = Path(__file__).parent
CODES = {
    "fausse-amende.png": "https://amendes-gouv-paiement.example/payer?dossier=FR4471",
    "officiel.png": "https://www.service-public.fr/",
    "wifi-ouvert.png": "WIFI:T:nopass;S:WiFi_Gratuit_Gare;;",
    "local-redirect.png": "http://127.0.0.1:8765/r1",
    "local-meta.png": "http://127.0.0.1:8765/meta",
}

for name, data in CODES.items():
    qrcode.make(data, box_size=8, border=4).save(HERE / name)
    print(name, "→", data)

# Vidéo MJPEG pour simuler la caméra dans les tests (le QR code « fausse amende »)
import io

from PIL import Image

frame = Image.new("RGB", (640, 480), (90, 90, 90))
frame.paste(Image.open(HERE / "fausse-amende.png").convert("RGB").resize((300, 300)), (170, 90))
with open(HERE / "camera.mjpeg", "wb") as fh:
    for _ in range(5):
        buf = io.BytesIO()
        frame.save(buf, "JPEG", quality=85)
        fh.write(buf.getvalue())
print("camera.mjpeg")
