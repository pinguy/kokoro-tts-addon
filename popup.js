// Popup script for Kokoro TTS Firefox addon
let currentAudio = null;
let currentAudioBlob = null;
let currentAudioUrl = null;
let isGenerating = false;

// DOM elements
const textInput = document.getElementById('textInput');
const voiceSelect = document.getElementById('voiceSelect');
const speedInput = document.getElementById('speedInput');
const speedValue = document.getElementById('speedValue');
const langSelect = document.getElementById('langSelect');
const speakBtn = document.getElementById('speakBtn');
const stopBtn = document.getElementById('stopBtn');
const status = document.getElementById('status');
const audioPlayer = document.getElementById('audioPlayer');
const audioControls = document.getElementById('audioControls');
const downloadBtn = document.getElementById('downloadBtn');
const replayBtn = document.getElementById('replayBtn');

// Quick action buttons
const getSelectionBtn = document.getElementById('getSelection');
const getPageBtn = document.getElementById('getPage');
const clearTextBtn = document.getElementById('clearText');

// Voice and Language Mappings for display (can be extended)
const VOICE_DISPLAY_NAMES = {
    'af_heart': 'American Female (Heart)',
    'af_alloy': 'American Female (Alloy)',
    'af_aoede': 'American Female (Aoede)',
    'af_bella': 'American Female (Bella)',
    'af_jessica': 'American Female (Jessica)',
    'af_kore': 'American Female (Kore)',
    'af_nicole': 'American Female (Nicole)',
    'af_nova': 'American Female (Nova)',
    'af_river': 'American Female (River)',
    'af_sarah': 'American Female (Sarah)',
    'af_sky': 'American Female (Sky)',
    'am_adam': 'American Male (Adam)',
    'am_echo': 'American Male (Echo)',
    'am_eric': 'American Male (Eric)',
    'am_fenrir': 'American Male (Fenrir)',
    'am_liam': 'American Male (Liam)',
    'am_michael': 'American Male (Michael)',
    'am_onyx': 'American Male (Onyx)',
    'am_puck': 'American Male (Puck)',
    'am_santa': 'American Male (Santa)',
    'bf_alice': 'British Female (Alice)',
    'bf_emma': 'British Female (Emma)',
    'bf_isabella': 'British Female (Isabella)',
    'bf_lily': 'British Female (Lily)',
    'bm_daniel': 'British Male (Daniel)',
    'bm_fable': 'British Male (Fable)',
    'bm_george': 'British Male (George)',
    'bm_lewis': 'British Male (Lewis)'
};

const LANGUAGE_DISPLAY_NAMES = {
    'a': '🇺🇸 American English',
    'b': '🇬🇧 British English',
    'e': '🇪🇸 Spanish',
    'f': '🇫🇷 French',
    'h': '🇮🇳 Hindi',
    'i': '🇮🇹 Italian',
    'j': '🇯🇵 Japanese',
    'p': '🇧🇷 Portuguese (BR)',
    'z': '🇨🇳 Mandarin Chinese'
};

// Initialize on DOM content loaded
document.addEventListener('DOMContentLoaded', async () => {
    await populateDropdownsFromSever(); // Populate dropdowns first
    await loadSettings(); // Then load user settings
    setupEventListeners();
    checkServerStatus();
});

/**
 * Sets up all event listeners for the popup UI elements.
 */
function setupEventListeners() {
    // Update speed value display when slider moves
    speedInput.addEventListener('input', (e) => {
        speedValue.textContent = e.target.value + 'x';
    });

    // Main speak and stop buttons
    speakBtn.addEventListener('click', generateSpeech);
    stopBtn.addEventListener('click', stopSpeech);

    // Audio control buttons
    downloadBtn.addEventListener('click', downloadAudio);
    replayBtn.addEventListener('click', replayAudio);

    // Quick action buttons
    getSelectionBtn.addEventListener('click', getSelectedText);
    getPageBtn.addEventListener('click', getPageText);
    clearTextBtn.addEventListener('click', () => {
        textInput.value = '';
        hideAudioControls();
    });

    // Auto-save settings when voice, speed, or language selection changes
    [voiceSelect, speedInput, langSelect].forEach(element => {
        element.addEventListener('change', saveSettings);
    });

    // Auto-resize text area as user types
    textInput.addEventListener('input', function() {
        this.style.height = 'auto'; // Reset height to recalculate
        this.style.height = this.scrollHeight + 'px'; // Set height to scroll height
    });

    // Audio player event listeners
    audioPlayer.addEventListener('ended', () => {
        resetUI();
    });

    audioPlayer.addEventListener('loadstart', () => {
        showAudioControls();
    });
}

/**
 * Shows the audio control buttons (download/replay)
 */
function showAudioControls() {
    audioControls.style.display = 'block';
    downloadBtn.disabled = !currentAudioBlob;
}

/**
 * Hides the audio control buttons
 */
function hideAudioControls() {
    audioControls.style.display = 'none';
    cleanupAudioResources();
}

/**
 * Downloads the current audio file
 */
function downloadAudio() {
    if (!currentAudioBlob) {
        showStatus('No audio to download', 'error');
        return;
    }

    try {
        // Create filename with timestamp and voice info
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const voice = voiceSelect.options[voiceSelect.selectedIndex].text.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `kokoro_tts_${voice}_${timestamp}.wav`;

        // Create download link
        const downloadUrl = URL.createObjectURL(currentAudioBlob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Clean up the download URL
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

        showStatus('Audio downloaded successfully!', 'success');
    } catch (error) {
        console.error('Download error:', error);
        showStatus('Failed to download audio', 'error');
    }
}

/**
 * Replays the current audio
 */
function replayAudio() {
    if (audioPlayer.src) {
        audioPlayer.currentTime = 0;
        audioPlayer.play();
        showStatus('Replaying audio...', 'success');
    } else {
        showStatus('No audio to replay', 'error');
    }
}

/**
 * Cleans up audio resources (URLs and references)
 */
function cleanupAudioResources() {
    if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
        currentAudioUrl = null;
    }
    currentAudioBlob = null;
    audioPlayer.src = '';
    audioPlayer.style.display = 'none';
}

/**
 * Loads user settings (voice, speed, language) from Firefox local storage
 * and updates the UI elements accordingly.
 */
async function loadSettings() {
    try {
        const result = await browser.storage.local.get({
            voice: 'af_heart', // Default voice
            speed: 1.0,        // Default speed
            language: 'a'      // Default language (American English)
        });

        // Only set the value if the option exists, otherwise default will be used
        if (Array.from(voiceSelect.options).some(option => option.value === result.voice)) {
            voiceSelect.value = result.voice;
        } else {
            voiceSelect.value = 'af_heart'; // Fallback to a safe default if saved voice is not available
        }

        speedInput.value = result.speed;
        speedValue.textContent = result.speed + 'x';

        if (Array.from(langSelect.options).some(option => option.value === result.language)) {
            langSelect.value = result.language;
        } else {
            langSelect.value = 'a'; // Fallback to a safe default if saved language is not available
        }

    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

/**
 * Saves current user settings (voice, speed, language) to Firefox local storage.
 */
async function saveSettings() {
    try {
        await browser.storage.local.set({
            voice: voiceSelect.value,
            speed: parseFloat(speedInput.value),
            language: langSelect.value
        });
    } catch (error) {
        console.error('Failed to save settings:', error);
    }
}

/**
 * Gets the currently selected text from the active tab and populates the text input.
 * The injected code is wrapped in an IIFE to prevent variable conflicts.
 */
async function getSelectedText() {
    try {
        const tabs = await browser.tabs.query({active: true, currentWindow: true});
        const results = await browser.tabs.executeScript(tabs[0].id, {
            code: `
                // IIFE to create a private scope for injected code
                (function() {
                    const pageSelection = window.getSelection();
                    return pageSelection.toString().trim();
                })(); // Immediately invoke the function
            `
        });

        if (results && results[0]) {
            textInput.value = results[0];
            showStatus('Selected text captured!', 'success');
        } else {
            showStatus('No text selected', 'error');
        }
    } catch (error) {
        console.error('Error getting selected text:', error);
        showStatus('Failed to get selection: ' + error.message, 'error');
    }
}

/**
 * Gets the main visible text content from the active tab and populates the text input.
 * It uses a TreeWalker and is wrapped in an IIFE to prevent variable conflicts.
 */
async function getPageText() {
    try {
        const tabs = await browser.tabs.query({active: true, currentWindow: true});
        const results = await browser.tabs.executeScript(tabs[0].id, {
            code: `
                // IIFE to create a private scope for injected code
                (function() {
                    const walker = document.createTreeWalker(
                        document.body,
                        NodeFilter.SHOW_TEXT,
                        {
                            acceptNode: function(node) {
                                const parent = node.parentElement;
                                if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
                                    return NodeFilter.FILTER_REJECT;
                                }
                                return NodeFilter.FILTER_ACCEPT;
                            }
                        }
                    );

                    let pageContentText = '';
                    let node;
                    while (node = walker.nextNode()) {
                        const nodeText = node.textContent.trim();
                        if (nodeText) {
                            pageContentText += nodeText + ' ';
                        }
                    }

                    return pageContentText.trim().substring(0, 5000);
                })(); // Immediately invoke the function
            `
        });

        if (results && results[0]) {
            textInput.value = results[0];
            showStatus('Page text captured!', 'success');
        } else {
            showStatus('No text found on page', 'error');
        }
    } catch (error) {
        console.error('Error getting page text:', error);
        showStatus('Failed to get page text: ' + error.message, 'error');
    }
}

/**
 * Checks the status of the local Kokoro TTS server by pinging its health endpoint.
 * Also populates the voice and language dropdowns if the server is healthy.
 */
async function checkServerStatus() {
    try {
        const response = await fetch('http://localhost:8000/health');
        if (response.ok) {
            showStatus('Kokoro server connected ✓', 'success');
            // We already populate on DOMContentLoaded, but this can serve as a re-check
            // if needed. For now, it's primarily for status message.
        } else {
            showStatus('Kokoro server not responding', 'error');
        }
    } catch (error) {
        console.error('Error checking server status:', error);
        showStatus('Kokoro server not running - Start local server first', 'error');
    }
}

/**
 * Fetches available voices and languages from the server and populates the dropdowns.
 */
async function populateDropdownsFromSever() {
    try {
        const response = await fetch('http://localhost:8000/health');
        if (response.ok) {
            const data = await response.json();

            // Clear existing options
            voiceSelect.innerHTML = '';
            langSelect.innerHTML = '';

            // Populate Voice dropdown
            data.available_voices.forEach(voiceCode => {
                const option = document.createElement('option');
                option.value = voiceCode;
                option.textContent = VOICE_DISPLAY_NAMES[voiceCode] || voiceCode; // Use display name or code
                voiceSelect.appendChild(option);
            });

            // Populate Language dropdown
            data.available_languages.forEach(langCode => {
                const option = document.createElement('option');
                option.value = langCode;
                option.textContent = LANGUAGE_DISPLAY_NAMES[langCode] || langCode; // Use display name or code
                langSelect.appendChild(option);
            });

        } else {
            console.error('Failed to fetch server capabilities:', response.statusText);
            showStatus('Failed to load voices/languages from server.', 'error');
            // Optionally, if server is down, you might want to disable speak button
            speakBtn.disabled = true;
        }
    } catch (error) {
        console.error('Error fetching server capabilities:', error);
        showStatus('Could not connect to TTS server to get available options.', 'error');
        speakBtn.disabled = true; // Disable if server isn't reachable
    }
}

/**
 * Generates speech from the text input using the local Kokoro TTS server.
 * Plays the audio and handles UI state during generation.
 */
async function generateSpeech() {
    const text = textInput.value.trim();
    if (!text) {
        showStatus('Please enter some text', 'error');
        return;
    }

    if (isGenerating) return;

    // Clean up previous audio resources
    cleanupAudioResources();
    hideAudioControls();

    isGenerating = true;
    speakBtn.style.display = 'none';
    stopBtn.style.display = 'block';
    showStatus('Generating speech...', 'loading');

    try {
        const response = await fetch('http://localhost:8000/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: text,
                voice: voiceSelect.value,
                speed: parseFloat(speedInput.value),
                language: langSelect.value
            })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status} - ${await response.text()}`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);

        // Store references for download functionality
        currentAudioBlob = audioBlob;
        currentAudioUrl = audioUrl;

        // Play audio
        audioPlayer.src = audioUrl;
        audioPlayer.style.display = 'block';
        audioPlayer.play();

        currentAudio = audioPlayer;
        showStatus('Speech generated successfully! 🎉', 'success');
        showAudioControls();

    } catch (error) {
        console.error('TTS Error:', error);
        showStatus('Failed to generate speech: ' + error.message, 'error');
        cleanupAudioResources();
    } finally {
        isGenerating = false;
        if (!currentAudio || currentAudio.paused) {
            resetUI();
        }
    }
}

/**
 * Stops any currently playing speech audio and resets the UI.
 */
function stopSpeech() {
    if (currentAudio && !currentAudio.paused) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
    }
    resetUI();
    showStatus('Stopped', 'success');
}

/**
 * Resets the UI state of the speak/stop buttons and generation status.
 */
function resetUI() {
    speakBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    isGenerating = false;
}

/**
 * Displays a status message in the popup.
 * @param {string} message - The message to display.
 * @param {string} type - The type of status (e.g., 'success', 'error', 'loading').
 */
function showStatus(message, type) {
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';

    // Auto-hide success messages after a delay
    if (type === 'success') {
        setTimeout(() => {
            status.style.display = 'none';
        }, 3000);
    }
}
