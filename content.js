// Content script for Kokoro TTS addon
// This script is injected into every webpage to provide in-page TTS features.

(function() {
    'use strict';
    
    let isFloatingButtonVisible = false;
    let floatingButton = null;
    let lastSelection = '';
    let audioPlayerIframe = null; // To hold the sandboxed audio player iframe

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
        audioPlayerIframe.src = browser.runtime.getURL('player.html');

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
        floatingButton.innerHTML = '🎙️';
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
        try {
            showNotification('Generating speech...', 'loading');
            const response = await browser.runtime.sendMessage({
                action: 'generateTTS',
                text: text
            });
            
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

    // Listener for messages from the background script to play audio
    browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'playTTSAudio' && request.audioUrl) {
            console.log("Content Script: Received 'playTTSAudio' message from background script.");
            playAudioInPage(request.audioUrl);
            sendResponse({success: true}); // Acknowledge receipt
            return true; // Indicate async response
        }
    });
    
})(); // End of IIFE for content script

