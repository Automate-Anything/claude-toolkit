"""The couple's film, version 3: the edit list built from the client's edited script (the script file). She tells
it, then we see it. A scene take that is shorter than its call is slowed to fit (a gentle slow motion), never frozen.
Writes edit/edl-story-v3.json.

  python example_edit_list.py
"""
import io, json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as vid
W = vid.WORK
FF = os.path.join(vid.BIN, 'ffmpeg.exe')
FP = os.path.join(vid.BIN, 'ffprobe.exe')
TAKES = os.path.join(W, 'prove', 'takes')


def dur(path):
    r = subprocess.run([FP, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


A = lambda n: dur(os.path.join(W, 'audio', n.replace('/', os.sep) + '.mp3'))
T = lambda n: dur(os.path.join(TAKES, n + '.mp4'))


def stretch(take, need):
    """A copy of the take slowed so it lasts `need` seconds (picture only); returns its name."""
    have = T(take)
    out = take + 'S'
    f = max(1.0, need / have)
    dst = os.path.join(TAKES, out + '.mp4')
    subprocess.run([FF, '-v', 'error', '-y', '-i', os.path.join(TAKES, take + '.mp4'), '-vf', 'setpts=%.4f*PTS,fps=24' % f, '-an', '-c:v', 'libx264', '-crf', '17', '-preset', 'fast', dst], check=True)
    return out


shots = []
t = 0.0


def shot(take, i, o, **kw):
    global t
    d = round(o - i, 3)
    s = {"at": round(t, 3), "dur": d, "take": take, "in": i, "out": o}
    s.update(kw)
    shots.append(s)
    t = round(t + d, 3)
    return s


def talk(name):
    return name + '-C' if os.path.exists(os.path.join(TAKES, name + '-C.mp4')) else name


# 1. the hook, 2. what it is
shot('S3-1', 0.0, T('S3-1'))
s = shot(talk('S3-2'), 0.0, T('S3-2'))
s['wordmark'] = {"at": round(s['at'] + 0.5, 2), "dur": 2.2, "pos": "top"}
# 3. the pharmacy: she tells it, then her garden
shot('S3-3', 0.0, T('S3-3'))
u1 = 0.3; c1 = u1 + A('story/s4-assistant-pharm-1') + 0.3; u2 = c1 + A('story/s4-clerk-1') + 0.25; b = u2 + A('story/s4-assistant-pharm-2') + 0.3
need = b + 2.8
g = shot(stretch('GARDEN-1', need), 0.0, need, audio={"take": "GARDEN-1", "in": 0.0})
g['call'] = [{"at": round(g['at'] + u1, 2), "who": "assistant", "text": "Hi, I'm the assistant. I'm calling on behalf of the woman Feldman, about her prescription. Is it ready?", "audio": "story/s4-assistant-pharm-1"},
             {"at": round(g['at'] + c1, 2), "who": "pharmacy", "text": "Feldman... yeah. Should be ready after two.", "audio": "story/s4-clerk-1"},
             {"at": round(g['at'] + u2, 2), "who": "assistant", "text": "Great. Thank you.", "audio": "story/s4-assistant-pharm-2"}]
g['bubble'] = [{"who": "assistant", "kind": "reply", "text": "Your prescription is ready after 2. I put it on your calendar.", "at": round(g['at'] + b, 2), "life": 2.6}]
# 4. the calls she does not answer, then her kitchen
shot(talk('S3-4'), 0.0, T('S3-4'))
r1 = 2.2; w1 = r1 + 3.3 + 0.4; d1 = w1 + A('story/s4-assistant-warranty') + 0.3; p1 = d1 + 2.5
need = p1 + 3.0
k = shot(stretch('SINK-1', need), 0.0, need, audio={"take": "SINK-1", "in": 0.0})
k['call'] = [{"at": round(k['at'] + r1, 2), "who": "warranty", "text": "We've been trying to reach you about your car's extended warranty.", "audio": "warranty-h--adam", "len": 3.3},
             {"at": round(k['at'] + w1, 2), "who": "assistant", "text": "She's not interested. Please take this number off your list.", "audio": "story/s4-assistant-warranty"}]
k['bubble'] = [{"who": "assistant", "kind": "reply", "text": "I also added your number to the Do Not Call list.", "at": round(k['at'] + d1, 2), "life": 2.3},
               {"who": "assistant", "kind": "reply", "text": "Dr. Patel's office. Your Tuesday moved to 10:30. I said yes.", "at": round(k['at'] + p1, 2), "life": 2.8}]
# 5. her daughter: the whole trip. Her line with a look at him in the middle, then the daughter on her sofa and the book
d5 = T('S3-5')
shot('S3-5', 0.0, 6.2)
shot('MAN-1', 0.3, 3.1, audio={"take": "S3-5", "in": 6.2})
shot('S3-5', 9.0, d5)
need = 11.6
m = shot(stretch('DAUGHTER-SOFA-1', need), 0.0, need, audio={"take": "DAUGHTER-SOFA-1", "in": 0.0})
m['bubble'] = [{"who": "daughter", "kind": "sent", "text": "Plan Italy. Ten days in May. Rome, then the coast.", "at": round(m['at'] + 0.4, 2), "life": 2.8, "side": "right"},
               {"who": "assistant", "kind": "reply", "text": "Done. Flights, four hotels, a rental car, nine dinners, all booked, all inside your budget. Here's the trip.", "at": round(m['at'] + 3.4, 2), "life": 3.3, "side": "right"}]
m['book'] = {"at": round(m['at'] + 6.9, 2), "dur": 4.6, "side": "right", "pages": [
    {"title": "Italy", "lines": ["Ten days in May", "Rome, then the coast"], "badge": "Your trip"},
    {"title": "Flights", "lines": ["New York to Rome, May 9", "Naples to New York, May 19"], "badge": "Booked"},
    {"title": "Hotels", "lines": ["Rome, 4 nights", "Sorrento, 3 nights", "Positano, 2 nights", "Naples, 1 night"], "badge": "Booked"},
    {"title": "Rental car", "lines": ["Rome, May 13", "Returned in Naples, May 19"], "badge": "Booked"},
    {"title": "Dinners", "lines": ["Nine tables", "One for every night out"], "badge": "Booked"}]}
# 6. her son-in-law: the price it watched
shot(talk('S3-6'), 0.0, T('S3-6'))
need = 7.4
tm = shot(stretch('TOUCH-1', need), 0.0, need, audio={"take": "TOUCH-1", "in": 0.0})
tm['bubble'] = [{"who": "assistant", "kind": "reply", "text": "The V12 is $289 at Best Buy, down from $399. I bought it, inside your limit. It arrives Thursday.", "at": round(tm['at'] + 0.3, 2), "life": 4.4},
                {"who": "soninlaw", "kind": "sent", "text": "Ha. Thanks.", "at": round(tm['at'] + 5.0, 2), "life": 2.2}]
# 7. her neighbor: she laughs, and the footage holds the surprise
shot('S3-7', 0.0, T('S3-7'))
g1 = 0.5; c1 = g1 + A('story/s4-assistant-greet') + 0.3; b1 = c1 + A('story/s4-caller-1') + 0.3
need = b1 + A('story/s4-assistant-book') + 0.7
lad = shot(stretch('LADDER-1', need), 0.0, need, audio={"take": "LADDER-1", "in": 0.0})
lad['call'] = [{"at": round(lad['at'] + g1, 2), "who": "assistant", "text": "Example Landscaping, this is the assistant. What can I do for you?", "audio": "story/s4-assistant-greet"},
               {"at": round(lad['at'] + c1, 2), "who": "caller", "text": "Hey, my yard is covered in leaves. When can you come to clean it up?", "audio": "story/s4-caller-1"},
               {"at": round(lad['at'] + b1, 2), "who": "assistant", "text": "Yeah, sure. Thursday at nine's open. Is that fine?", "audio": "story/s4-assistant-book"}]
# 8. what it changed, 9. his line, the two of them, 10. the card
shot(talk('S3-8'), 0.0, T('S3-8'))
shot('S3-W', 0.0, T('S3-W'))
shot('LEAN-1', 0.5, 3.6)
shot('CARD', 0.0, 7.0)

edl = {"note": "The couple's film, version 3, from the client's edited script: she tells it, then we see it; her face animated alone, him listening, composited; the trip book; the calls one voice at a time.",
       "fps": 24, "size": [1920, 1080], "shots": shots}
out = os.path.join(W, 'edit', 'edl-story-v3.json')
io.open(out, 'w', encoding='utf-8', newline='\n').write(json.dumps(edl, indent=1))
print('wrote', out, 'total %.1f s' % t, '| shots', len(shots))
for s in shots:
    print('  %6.1f %5.1f %s' % (s['at'], s['dur'], s['take']))
