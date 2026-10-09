"""the woman's four on-camera segments (the script file) in one voice, for the talking takes. The voice id comes from the
client's pick (row 53); until then the stand-in is candidate 1, Carol.

  python voice_lines.py [voice_id]      writes work/audio/voice-lines/line-1..4.mp3
"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as vid

KEY = vid._E["ELEVENLABS_API_KEY"]
VOICE = sys.argv[1] if len(sys.argv) > 1 else "VOICE_ID_OF_THE_WOMAN"  # voice 4, the client's pick 2026-09-30
OUT = os.path.join(vid.WORK, "audio", "voice-lines")
os.makedirs(OUT, exist_ok=True)

SEG = {
    "line-1": "[amused, leaning in] You gotta hear this. [pause] This is insane.",
    "line-2": "[light] It's called NAME-SPELLED-FOR-SPEECH. My son told me about it. I just write to it, or call it, like a person.",
    "line-3": "[delighted] It literally does everything for me. Forty minutes I used to sit on hold with Hartwell Pharmacy. Now I just said, call them. [pause] And it's done.",
    "line-4": "[light] And the calls from numbers you don't know? It answers them. It only rings me for my kids. [small laugh] Or the doctor.",
    "line-5": "[delighted] My daughter the daughter said to it, plan Italy. Ten days. It literally booked the flights, the hotels, the dinners. It even reserved her car rental. [pause] And it sent her a little book of the trip.",
    "line-6": "[amused] My son-in-law the son-in-law wanted that vacuum. He told it: buy it when it drops under three hundred.",
    "line-7": "[amused] My neighbor the neighbor, he does gardens. I told him about NAME-SPELLED-FOR-SPEECH. Two days later, he called me, and he's like, what the heck? [laughs]",
    "line-8": "[warm, softer] Honestly? It changed our lives. I don't stress anymore. I don't have to understand any of it. [soft] I just ask NAME-SPELLED-FOR-SPEECH.",
}


def dialogue(text, fn):
    if os.path.exists(fn) and os.path.getsize(fn) > 2000 and "--force" not in sys.argv:
        return True
    body = {"model_id": "eleven_v4", "inputs": [{"text": text, "voice_id": VOICE}]}
    r = subprocess.run(["curl", "-sS", "-m", "120", "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128", "-H", "xi-api-key: " + KEY, "-H", "Content-Type: application/json", "--data-binary", json.dumps(body), "-o", fn, "-w", "%{http_code}"], capture_output=True, text=True)
    ok = r.stdout.strip() == "200" and os.path.getsize(fn) > 2000
    if not ok:
        print("FAILED", os.path.basename(fn), r.stdout.strip(), open(fn, "rb").read(160))
        os.remove(fn)
    else:
        vid.log({"venue": "elevenlabs", "name": os.path.basename(fn), "chars": len(text), "usd": round(len(text) / 1000 * 0.08, 4), "kind": "dialogue v4"})
        print("ok", os.path.basename(fn))
    return ok


for k, t in SEG.items():
    dialogue(t, os.path.join(OUT, k + ".mp3"))
