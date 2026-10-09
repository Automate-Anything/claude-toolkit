"""the woman's voice (film three, the script file): numbered candidates for the client's ear. Older women from the ElevenLabs
library, each saying the woman's opening lines with human texture (eleven_v4 dialogue, tags). the client approves every
voice before it is used (2026-09-30: "every single voice through the entire thing needs to be approved").

  python voice_candidates.py       writes work/audio/voice-candidates/NN-name.mp3
"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as vid

KEY = vid._E["ELEVENLABS_API_KEY"]
OUT = os.path.join(vid.WORK, "audio", "voice-candidates")
os.makedirs(OUT, exist_ok=True)
LIB = json.load(open(os.path.join(vid.WORK, "audio", "voice-library.json"), encoding="utf-8"))
ORDER = ["5u41aNhyCU6hXOcjPPv0", "xIzR6egd3S3LJZbVW0c1", "8fwYhwfiWkLjR4FKLHSQ", "VOICE_ID_OF_THE_WOMAN", "0rEo3eAjssGDUCXHYENf", "p2Wol3C7j3rHbfOrbL18", "aIu5oHglU5AHNc2x0AZu", "q1Hhtkt94vkD6q7p50hW"]
LINES = ("[amused] Okay. I have to tell you the craziest thing I started using. [pause] It's called the assistant. "
         "[light] My son put it on my phone. You just... message it. Like a person. "
         "[laughs] Forty minutes I used to sit on hold with that pharmacy. Now I say, call them, and it calls them. And I'm in the garden.")


def add(owner, vid_):
    r = subprocess.run(["curl", "-sS", "-m", "60", "-X", "POST", "https://api.elevenlabs.io/v1/voices/add/%s/%s" % (owner, vid_), "-H", "xi-api-key: " + KEY, "-H", "Content-Type: application/json", "--data-binary", json.dumps({"new_name": LIB[vid_]["name"][:40]}), "-w", " %{http_code}"], capture_output=True, text=True)
    return r.stdout[-3:] in ("200", "201", "400")  # 400: already on the account


def dialogue(voice_id, text, fn):
    if os.path.exists(fn) and os.path.getsize(fn) > 2000:
        return True
    body = {"model_id": "eleven_v4", "inputs": [{"text": text, "voice_id": voice_id}]}
    r = subprocess.run(["curl", "-sS", "-m", "120", "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128", "-H", "xi-api-key: " + KEY, "-H", "Content-Type: application/json", "--data-binary", json.dumps(body), "-o", fn, "-w", "%{http_code}"], capture_output=True, text=True)
    ok = r.stdout.strip() == "200" and os.path.getsize(fn) > 2000
    if not ok:
        print("FAILED", os.path.basename(fn), r.stdout.strip(), open(fn, "rb").read(160))
        os.remove(fn)
    else:
        vid.log({"venue": "elevenlabs", "name": os.path.basename(fn), "chars": len(text), "usd": round(len(text) / 1000 * 0.08, 4), "kind": "dialogue v4"})
    return ok


index = []
for k, vid_ in enumerate(ORDER, 1):
    name = LIB[vid_]["name"].split(" - ")[0].split(" " + chr(0x2013) + " ")[0].strip()
    short = name.split()[0].lower()
    fn = os.path.join(OUT, "%02d-%s.mp3" % (k, short))
    if add(LIB[vid_]["owner"], vid_) and dialogue(vid_, LINES, fn):
        index.append("%d. %s (%s, %s)" % (k, name, LIB[vid_].get("accent"), vid_))
print("\n".join(index))
