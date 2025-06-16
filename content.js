// Content script for Kokoro TTS Chrome extension
// This script is injected into every webpage to provide in-page TTS features.

(function() {
    'use strict';
    
    let isFloatingButtonVisible = false;
    let floatingButton = null;
    let lastSelection = '';
    let audioPlayerIframe = null; // To hold the sandboxed audio player iframe

    // Add at top of file
    let audioContext;
    let audioQueue = [];
    let isPlaying = false;
    let currentSourceNode = null; // To keep track of the currently playing AudioBufferSourceNode

    // Initialize audio context
    function initAudioContext() {
        if (!audioContext) {
            // Check if AudioContext is already running or suspended, try to resume
            audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 22050
            });
            audioContext.suspend(); // Start in suspended state
            console.log("Content Script: AudioContext initialized and suspended.");
        }
        // If suspended, try to resume it on user interaction
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log("Content Script: AudioContext resumed.");
            }).catch(e => {
                console.error("Content Script: Failed to resume AudioContext:", e);
            });
        }
    }

    // Audio processing function
    async function processAudioChunk(chunk) {
        initAudioContext();
        
        // Convert to Float32 audio buffer
        const audioData = new Int16Array(chunk);
        const float32Data = new Float32Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
            float32Data[i] = audioData[i] / 32768.0;
        }
        
        // Create audio buffer
        const buffer = audioContext.createBuffer(1, float32Data.length, 22050);
        buffer.copyToChannel(float32Data, 0);
        
        // Create source and schedule playback
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        currentSourceNode = source; // Keep reference to current source

        return new Promise(resolve => {
            source.onended = () => {
                if (currentSourceNode === source) { // Only clear if it's the one we just played
                    currentSourceNode = null;
                }
                resolve();
            };
            source.start();
        });
    }

    // Process audio queue
    async function processQueue() {
        if (isPlaying || audioQueue.length === 0) return;
        
        isPlaying = true;
        showNotification('Speech streaming...', 'loading'); // Indicate streaming started
        while (audioQueue.length > 0) {
            const chunk = audioQueue.shift();
            try {
                await processAudioChunk(chunk);
            } catch (e) {
                console.error("Error processing audio chunk:", e);
                showNotification('Error playing stream', 'error');
                stopStreamingAudio();
                break;
            }
        }
        isPlaying = false;
        // The streamEnd message will handle the final success notification
    }

    /**
     * Stops any currently playing streaming audio and clears the queue.
     */
    function stopStreamingAudio() {
        if (currentSourceNode) {
            currentSourceNode.stop();
            currentSourceNode.disconnect();
            currentSourceNode = null;
        }
        audioQueue = []; // Clear the queue
        isPlaying = false;
        if (audioContext && audioContext.state === 'running') {
            audioContext.suspend().then(() => {
                console.log("Content Script: AudioContext suspended due to stop.");
            }).catch(e => {
                console.error("Content Script: Failed to suspend AudioContext:", e);
            });
        }
        showNotification('Speech playback stopped', 'info');
    }


    /**
     * Creates and injects an invisible iframe to handle audio playback.
     * This bypasses the host page's Content Security Policy (CSP) which
     * often blocks 'data:' URLs for audio.
     */
    function createAudioPlayerIframe() {
        if (document.getElementById('kokoro-tts-player-iframe')) {
            audioPlayerIframe = document.getElementById('kokoro-tts-player-iframe');
            return;
        }

        console.log("Content Script: Creating audio player iframe.");
        audioPlayerIframe = document.createElement('iframe');
        audioPlayerIframe.id = 'kokoro-tts-player-iframe';
        audioPlayerIframe.src = chrome.runtime.getURL('player.html');

        // Style the iframe to be completely invisible and non-interactive
        Object.assign(audioPlayerIframe.style, {
            display: 'none',
            position: 'fixed',
            width: '1px',
            height: '1px',
            border: 'none',
            top: '-10px',
            left: '-10px'
        });
        
        // Ensure the iframe is loaded before we try to use it
        audioPlayerIframe.onload = () => {
             console.log("Content Script: Audio player iframe loaded successfully.");
        };

        document.body.appendChild(audioPlayerIframe);
    }
    
    // Create the iframe as soon as the body is available.
    if (document.body) {
        createAudioPlayerIframe();
    } else {
        document.addEventListener('DOMContentLoaded', createAudioPlayerIframe, { once: true });
    }

    /**
     * Creates and returns the floating TTS button element.
     * Only creates it once.
     * @returns {HTMLElement} The floating button element.
     */
    function createFloatingButton() {
        if (floatingButton) return floatingButton;

        floatingButton = document.createElement('div');
        floatingButton.id = 'kokoro-tts-float-btn';
        floatingButton.innerHTML = '💬';
        floatingButton.title = 'Speak with Kokoro TTS';
        
        Object.assign(floatingButton.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            width: '50px',
            height: '50px',
            backgroundColor: '#667eea',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            fontSize: '20px',
            cursor: 'pointer',
            zIndex: '10000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            transition: 'all 0.3s ease',
            transform: 'scale(0)',
            opacity: '0'
        });
        
        floatingButton.addEventListener('mouseenter', () => {
            floatingButton.style.transform = 'scale(1.1)';
            floatingButton.style.backgroundColor = '#5a67d8';
        });
        
        floatingButton.addEventListener('mouseleave', () => {
            floatingButton.style.transform = 'scale(1)';
            floatingButton.style.backgroundColor = '#667eea';
        });
        
        floatingButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            if (lastSelection) {
                await generateTTS(lastSelection); 
                hideFloatingButton();
            } else {
                showNotification('No text was selected when button appeared', 'error');
            }
        });
        
        document.body.appendChild(floatingButton);
        return floatingButton;
    }
    
    function showFloatingButton() {
        if (!floatingButton) createFloatingButton();
        
        floatingButton.style.display = 'flex';
        setTimeout(() => {
            floatingButton.style.transform = 'scale(1)';
            floatingButton.style.opacity = '1';
        }, 10);
        
        isFloatingButtonVisible = true;
    }
    
    function hideFloatingButton() {
        if (!floatingButton) return;
        
        floatingButton.style.transform = 'scale(0)';
        floatingButton.style.opacity = '0';
        
        setTimeout(() => {
            if (floatingButton) {
                floatingButton.style.display = 'none';
            }
        }, 300);
        
        isFloatingButtonVisible = false;
    }
    
    document.addEventListener('mouseup', () => {
        setTimeout(() => {
            const currentSelectionText = window.getSelection().toString().trim();
            if (currentSelectionText && currentSelectionText.length > 0) {
                if (currentSelectionText !== lastSelection) {
                    lastSelection = currentSelectionText;
                    showFloatingButton();
                }
            } else {
                lastSelection = '';
                if (isFloatingButtonVisible) {
                    hideFloatingButton();
                }
            }
        }, 100);
    });
    
    document.addEventListener('click', (e) => {
        if (e.target !== floatingButton && isFloatingButtonVisible) {
            const currentSelectionCheck = window.getSelection().toString().trim();
            if (!currentSelectionCheck) {
                hideFloatingButton();
            }
        }
    });
    
    async function generateTTS(text) {
        // Stop any existing streaming audio before starting a new one
        stopStreamingAudio(); 

        try {
            showNotification('Generating speech...', 'loading');
            const response = await new Promise(resolve =>
                chrome.runtime.sendMessage({
                    action: 'generateTTS',
                    text: text
                }, resolve)
            );
            
            if (response && !response.success) {
                showNotification('Failed: ' + response.error, 'error');
            }
        } catch (error) {
            console.error('Content Script: TTS Error in generateTTS:', error);
            showNotification('Failed to generate speech (client-side error)', 'error');
        }
    }
    
    let notificationTimeout = null;
    function showNotification(message, type = 'info') {
        const existing = document.getElementById('kokoro-tts-notification');
        if (existing) existing.remove();
        
        const notification = document.createElement('div');
        notification.id = 'kokoro-tts-notification';
        notification.textContent = message;
        
        const colors = {
            info: '#2196F3',
            success: '#4CAF50',
            error: '#f44336',
            loading: '#FF9800'
        };
        
        Object.assign(notification.style, {
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: colors[type] || colors.info,
            color: 'white',
            padding: '12px 20px',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '500',
            zIndex: '10001',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            opacity: '0',
            transition: 'opacity 0.3s ease'
        });
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '1';
        }, 10);
        
        clearTimeout(notificationTimeout);
        notificationTimeout = setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }, 3000);
    }
    
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            const selectedTextForHotkey = window.getSelection().toString().trim();
            if (selectedTextForHotkey) {
                generateTTS(selectedTextForHotkey);
            } else {
                showNotification('No text selected for hotkey', 'error');
            }
        }
    });

    /**
     * Plays the provided audio URL by sending it to the sandboxed iframe.
     * This function is now deprecated for streaming, but kept for compatibility
     * if the non-streaming `generate` endpoint is still used elsewhere.
     * @param {string} audioUrl - The data URL (base64) of the audio to play.
     */
    function playAudioInPage(audioUrl) {
        if (!audioPlayerIframe || !audioPlayerIframe.contentWindow) {
            console.error("Content Script: Audio player iframe is not ready.");
            showNotification('Audio player not ready. Please try again.', 'error');
            if (!audioPlayerIframe) createAudioPlayerIframe(); // Attempt to recover
            return;
        }
        
        console.log("Content Script: Posting audio URL to player iframe.");
        audioPlayerIframe.contentWindow.postMessage({
            action: 'playAudio',
            audioUrl: audioUrl
        }, '*'); // Use '*' for simplicity, or getURL origin for more security
    }

    // Listener for messages from the background script to play audio OR show status
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        const handleRequest = async () => {
            try {
                if (request.action === 'playTTSAudio' && request.audioUrl) {
                    console.log("Content Script: Received 'playTTSAudio' message from background script (non-streaming).");
                    playAudioInPage(request.audioUrl);
                    showNotification('Speech generated and now playing! 🎉', 'success');
                    return {success: true};
                } else if (request.action === 'showGeneratingSpeech') {
                    console.log("Content Script: Received 'showGeneratingSpeech' message from background script.");
                    showNotification('Generating speech...', 'loading');
                    return {success: true};
                } else if (request.action === 'streamTTSChunk') {
                    audioQueue.push(request.chunk);
                    await processQueue();
                    return {success: true};
                } else if (request.action === 'streamEnd') {
                    const checkPlayback = setInterval(() => {
                        if (audioQueue.length === 0 && !isPlaying) {
                            clearInterval(checkPlayback);
                            showNotification('Speech stream completed! 🎉', 'success');
                        }
                    }, 100);
                    return {success: true};
                } else if (request.action === 'streamError') {
                    stopStreamingAudio();
                    showNotification(`Speech stream error: ${request.error}`, 'error');
                    return {success: true};
                }
            } catch (error) {
                console.error("Message handling error:", error);
                return {success: false, error: error.message};
            }
        };

        handleRequest().then(sendResponse);
        return true; // Required for async sendResponse
    });
    
    // Listen for escape key to stop streaming audio
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isPlaying) {
            stopStreamingAudio();
            e.preventDefault(); // Prevent default escape behavior if any
        }
    });
    
})(); // End of IIFE for content script
