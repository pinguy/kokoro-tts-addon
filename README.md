# Kokoro TTS Add-on (v1.1)

> A Firefox extension for local neural TTS that runs so efficiently, even your old laptop feels futuristic.

## 🧠 What is this?

Kokoro TTS lets you convert any text into speech directly in Firefox — **entirely offline**, using a minimal Flask server and the Kokoro model.

No accounts. No cloud. No lag.

---

## 🔧 Installation

### 1. Download the Add-on & Server Script

From the [Releases Page](https://github.com/pinguy/kokoro-tts-addon/releases), grab:

- `kokoro-tts-addon_1.1.xpi`
- `server.py`

### 2. Install the Add-on

Go to `about:addons` → click the gear icon → `Install Add-on From File...`  
Choose the `.xpi` you downloaded.

### 3. Run the Local Server

Linux/macOS:
```bash
nohup python3 /path/to/server.py &

