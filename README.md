# Kokoro TTS Add-on

> 🧠 Local Neural Text-to-Speech for Firefox — fast, private, offline.

> **Tested on a Xeon E3-1265L v3 (2013)** — Ran multiple TTS jobs in parallel with barely perceptible lag.  
> If it works on this, it'll fly on your machine.

---

## 🔍 What is This?

Kokoro TTS is a Firefox extension that lets you convert selected or pasted text into natural-sounding speech — without needing an internet connection.  
It uses a lightweight Flask server and the Kokoro model running locally on your system.

- ✅ No accounts or logins
- ✅ No cloud APIs or telemetry
- ✅ No GPU required but helps a lot, if no usable GPU falls to using the CPU.

---

## 🚀 Features

- 🎙️ Neural TTS with multiple voice options
- 🔒 Offline-first & privacy-respecting
- 🧊 Lightweight: Small 82M parameters
- 🥔 Works on low-end CPUs
- 🌍 Linux, macOS, and Windows support

---

## ⚙️ Installation

### 1. Download from Releases

Head to the [Releases Page](https://github.com/pinguy/kokoro-tts-addon/releases) and grab:

- `kokoro-tts-addon_1.1.xpi`
- `server.py`

### 2. Install the Add-on in Firefox

- Go to `about:addons`
- Click the gear icon → `Install Add-on From File...`
- Select the `.xpi` you downloaded

### 3. Start the Local Server

#### macOS / Linux:
```bash
nohup python3 /path/to/server.py &
```

#### Windows:
Create a `.bat` file like this:
```bat
cd C:\path\to\server
start python server.py
```
Drop a shortcut to it in the Startup folder (`Win + R → shell:startup`).

To install espeak-ng on Windows:
1. Go to [espeak-ng releases](https://github.com/espeak-ng/espeak-ng/releases)
2. Click on **Latest release**
3. Download the appropriate `*.msi` file (e.g. **espeak-ng-20191129-b702b03-x64.msi**)
4. Run the downloaded installer

For advanced configuration and usage on Windows, see the [official espeak-ng Windows guide](https://github.com/espeak-ng/espeak-ng/blob/master/docs/guide.md)

---

## 🧪 How to Test

1. Visit `http://localhost:8000/health`  
2. You should see a simple “healthy” JSON response
3. Use the extension: paste text, pick a voice, click “Generate Speech” 🎉

---

## 📌 Notes

- First-time run will download the model
- Make sure Python 3.8+ is installed and in PATH
- All processing is local — nothing leaves your machine

---

## 🧩 Dependencies

You’ll need Python 3.8+ and `pip` installed. Most systems already have them.  
To install all required Python packages (including some optional extras for extended model usage), run:

```bash
pip install -r server/requirements.txt
```

---

## 📄 License

Licensed under the [Apache License 2.0](LICENSE)

---

## ❤️ Credits

Powered by the Kokoro TTS model

---

| Feature                                                          | Preview                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Popup UI**: Select text, click, and this pops up.              | [![UI Preview](https://i.imgur.com/zXvETFV.png)](https://i.imgur.com/zXvETFV.png)       |
| **Playback in Action**: After clicking "Generate Speech"         | [![Playback Preview](https://i.imgur.com/STeXJ78.png)](https://i.imgur.com/STeXJ78.png) |
| **System Notifications**: Get notified when playback starts      | *(not pictured)*                                             |
| **Settings Panel**: Server toggle, configuration options         | [![Settings](https://i.imgur.com/wNOgrnZ.png)](https://i.imgur.com/wNOgrnZ.png)         |
| **Voice List**: Browse the models available                      | [![Voices](https://i.imgur.com/3fTutUR.png)](https://i.imgur.com/3fTutUR.png)           |
| **Accents Supported**: 🇺🇸 American English, 🇬🇧 British English, 🇪🇸 Spanish, 🇫🇷 French, 🇮🇹 Italian, 🇧🇷 Portuguese (BR) the other 3 are buggy | [![Accents](https://i.imgur.com/lc7qgYN.png)](https://i.imgur.com/lc7qgYN.png)          |

---

# Known Bugs

If the Mic Pop UI is active in any other tab other tabs won't be able to use the player so see a message that it is playing and hearing nothing it open on a tab.

---
