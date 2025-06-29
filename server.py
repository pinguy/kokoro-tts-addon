#!/usr/bin/env python3
"""
Kokoro TTS Local Server - Smart GPU Detection
A local HTTP server that interfaces with the Kokoro TTS model for the Firefox addon.
Now with proper detection of unsupported/slow GPUs and forced CPU fallback.
"""

import os
import io
import json
import time
import tempfile
import multiprocessing
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
import logging

import torch
import soundfile as sf
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
from kokoro import KPipeline

# Configure basic logging for better diagnostics
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
app = Flask(__name__)
CORS(app)  # Enable CORS for all domains

# Global pipeline cache
pipelines: Dict[str, KPipeline] = {}

# Voice mapping as provided in your original script
VOICE_MAPPING = {
    'af_heart': 'af_heart',
    'af_alloy': 'af_alloy',
    'af_aoede': 'af_aoede',
    'af_bella': 'af_bella',
    'af_jessica': 'af_jessica',
    'af_kore': 'af_kore',
    'af_nicole': 'af_nicole',
    'af_nova': 'af_nova',
    'af_river': 'af_river',
    'af_sarah': 'af_sarah',
    'af_sky': 'af_sky',
    'am_adam': 'am_adam',
    'am_echo': 'am_echo',
    'am_eric': 'am_eric',
    'am_fenrir': 'am_fenrir',
    'am_liam': 'am_liam',
    'am_michael': 'am_michael',
    'am_onyx': 'am_onyx',
    'am_puck': 'am_puck',
    'am_santa': 'am_santa',
    'bf_alice': 'bf_alice',
    'bf_emma': 'bf_emma',
    'bf_isabella': 'bf_isabella',
    'bf_lily': 'bf_lily',
    'bm_daniel': 'bm_daniel',
    'bm_fable': 'bm_fable',
    'bm_george': 'bm_george',
    'bm_lewis': 'bm_lewis'
}

def get_gpu_info() -> Dict[str, Any]:
    """Get detailed GPU information including compute capability."""
    gpu_info = {}
    
    if torch.cuda.is_available():
        try:
            gpu_info['name'] = torch.cuda.get_device_name(0)
            props = torch.cuda.get_device_properties(0)
            gpu_info['memory_total'] = props.total_memory / (1024**3)  # GB
            gpu_info['multiprocessor_count'] = props.multi_processor_count
            gpu_info['max_threads_per_multiprocessor'] = props.max_threads_per_multi_processor
            gpu_info['compute_capability'] = f"{props.major}.{props.minor}"
            gpu_info['compute_capability_major'] = props.major
            gpu_info['compute_capability_minor'] = props.minor
            
            # Check if GPU is supported by modern PyTorch (6.0+ compute capability)
            compute_capability_numeric = props.major + (props.minor / 10.0)
            gpu_info['is_supported'] = compute_capability_numeric >= 6.0
            gpu_info['is_modern'] = compute_capability_numeric >= 7.0  # RTX series and newer
            
            # Detailed classification
            if compute_capability_numeric < 3.5:
                gpu_info['classification'] = "Very Old (Pre-Kepler)"
                gpu_info['performance_expectation'] = "Not supported by PyTorch"
            elif compute_capability_numeric < 5.0:
                gpu_info['classification'] = "Old (Kepler)"
                gpu_info['performance_expectation'] = "Limited PyTorch support, likely slower than modern CPU"
            elif compute_capability_numeric < 6.0:
                gpu_info['classification'] = "Legacy (Maxwell)"
                gpu_info['performance_expectation'] = "Deprecated in modern PyTorch, CPU likely faster"
            elif compute_capability_numeric < 7.0:
                gpu_info['classification'] = "Pascal Era"
                gpu_info['performance_expectation'] = "Good performance for most tasks"
            else:
                gpu_info['classification'] = "Modern (Turing/Ampere/Ada)"
                gpu_info['performance_expectation'] = "Excellent performance"
                
        except Exception as e:
            gpu_info['error'] = str(e)
            app.logger.warning(f"Could not get full GPU info: {e}")
            
    return gpu_info

def check_pytorch_cuda_compatibility() -> Tuple[bool, str]:
    """Check if CUDA is actually working with PyTorch."""
    if not torch.cuda.is_available():
        return False, "CUDA not available"
    
    try:
        # Try to create a simple tensor on GPU
        test_tensor = torch.randn(10, 10).cuda()
        result = test_tensor @ test_tensor.T
        result = result.cpu()  # Move back to CPU
        
        # Clear memory
        del test_tensor, result
        torch.cuda.empty_cache()
        
        return True, "CUDA working correctly"
        
    except Exception as e:
        error_msg = str(e).lower()
        if "no longer supports" in error_msg or "too old" in error_msg:
            return False, f"GPU too old for PyTorch: {e}"
        elif "out of memory" in error_msg:
            return False, f"GPU out of memory: {e}"
        else:
            return False, f"CUDA error: {e}"

def benchmark_cpu_performance() -> float:
    """Quick CPU benchmark for TTS inference."""
    app.logger.info("Running CPU performance benchmark...")
    
    try:
        # Configure CPU optimizations
        cpu_count = multiprocessing.cpu_count()
        optimal_threads = max(1, min(cpu_count, 16))  # Cap at 16 threads for TTS
        torch.set_num_threads(optimal_threads)
        torch.set_num_interop_threads(optimal_threads)
        
        # Force CPU mode
        torch.set_default_tensor_type('torch.FloatTensor')
        
        # Enable CPU optimizations
        if hasattr(torch.backends, 'mkldnn'):
            torch.backends.mkldnn.enabled = True
        
        # Create a test pipeline on CPU
        start_time = time.time()
        pipeline = KPipeline(lang_code='a')
        
        # Run inference
        test_text = "This is a performance test for text to speech generation using CPU processing."
        with torch.no_grad():
            audio_segments = list(pipeline(test_text, voice='af_heart', speed=1.0))
        
        cpu_time = time.time() - start_time
        
        del pipeline
        torch.cuda.empty_cache() if torch.cuda.is_available() else None
        
        app.logger.info(f"CPU benchmark completed in {cpu_time:.2f}s with {optimal_threads} threads")
        return cpu_time
        
    except Exception as e:
        app.logger.error(f"CPU benchmark failed: {e}")
        return float('inf')

def detect_optimal_device() -> Tuple[str, str, Dict[str, Any]]:
    """Intelligently detect the optimal device with proper GPU support checking."""
    device = "cpu"
    device_info = "CPU (default)"
    all_info = {}
    
    # Get CPU info
    cpu_count = multiprocessing.cpu_count()
    all_info['cpu_cores'] = cpu_count
    
    # Check GPU availability and compatibility
    gpu_info = get_gpu_info()
    all_info.update(gpu_info)
    
    if torch.cuda.is_available():
        app.logger.info(f"GPU detected: {gpu_info.get('name', 'Unknown')}")
        app.logger.info(f"GPU compute capability: {gpu_info.get('compute_capability', 'Unknown')}")
        app.logger.info(f"GPU classification: {gpu_info.get('classification', 'Unknown')}")
        app.logger.info(f"GPU memory: {gpu_info.get('memory_total', 0):.1f}GB")
        
        # Check if GPU is supported by PyTorch
        is_supported = gpu_info.get('is_supported', False)
        
        if not is_supported:
            reason = f"GPU compute capability {gpu_info.get('compute_capability', 'unknown')} is below PyTorch minimum requirement (6.0)"
            app.logger.warning(f"Forcing CPU: {reason}")
            device_info = f"CPU: {cpu_count} cores (GPU {gpu_info.get('name', 'Unknown')} unsupported - {reason})"
            all_info['decision_reason'] = reason
        else:
            # Check if CUDA actually works
            cuda_works, cuda_message = check_pytorch_cuda_compatibility()
            
            if not cuda_works:
                app.logger.warning(f"Forcing CPU: {cuda_message}")
                device_info = f"CPU: {cpu_count} cores (GPU CUDA failed - {cuda_message})"
                all_info['decision_reason'] = cuda_message
            else:
                # GPU is supported and working - but should we use it?
                if gpu_info.get('compute_capability_major', 0) < 7:
                    # For Pascal and older, run a quick comparison
                    app.logger.info("Older supported GPU detected, comparing with CPU performance...")
                    
                    # For TTS workloads, older GPUs (Pascal era) might not be worth the overhead
                    # Especially with a powerful CPU like E5-2680 v4
                    if cpu_count >= 12:  # High-end CPU
                        app.logger.info("High-end CPU detected with older GPU - favoring CPU for TTS workload")
                        device_info = f"CPU: {cpu_count} cores (High-end CPU favored over older GPU for TTS)"
                        all_info['decision_reason'] = "High-end CPU preferred for TTS over older GPU"
                    else:
                        device = "cuda"
                        device_info = f"GPU: {gpu_info['name']} (compute capability {gpu_info['compute_capability']})"
                        all_info['decision_reason'] = "GPU supported and should be faster"
                else:
                    # Modern GPU (Turing+), definitely use it
                    device = "cuda"
                    device_info = f"GPU: {gpu_info['name']} (compute capability {gpu_info['compute_capability']})"
                    all_info['decision_reason'] = "Modern GPU - optimal for TTS"
    else:
        device_info = f"CPU: {cpu_count} cores (CUDA not available)"
        all_info['decision_reason'] = "CUDA not available"
    
    # Configure the selected device
    if device == "cuda":
        # GPU optimizations
        app.logger.info("Configuring GPU optimizations...")
        torch.backends.cudnn.benchmark = True
        torch.backends.cudnn.enabled = True
        torch.set_default_tensor_type('torch.cuda.FloatTensor')
        
    else:
        # CPU optimizations - tuned for TTS workloads
        app.logger.info("Configuring CPU optimizations...")
        
        # Optimal thread count for TTS (not too many threads)
        optimal_threads = max(1, min(cpu_count, 16))  # Cap at 16 for TTS
        
        torch.set_num_threads(optimal_threads)
        torch.set_num_interop_threads(optimal_threads)
        
        # Enable CPU optimizations
        if hasattr(torch.backends, 'mkldnn'):
            torch.backends.mkldnn.enabled = True
            
        torch.set_default_tensor_type('torch.FloatTensor')
        
        all_info['cpu_threads_used'] = optimal_threads
        device_info += f" (using {optimal_threads} threads)"
    
    return device, device_info, all_info

# Initialize device detection
DEVICE, DEVICE_INFO, DEVICE_DETAILS = detect_optimal_device()
app.logger.info(f"Initialized with device: {DEVICE_INFO}")
app.logger.info(f"Decision reason: {DEVICE_DETAILS.get('decision_reason', 'No specific reason')}")

def get_pipeline(lang_code: str) -> KPipeline:
    """Get or create a pipeline for the given language code."""
    try:
        if lang_code not in pipelines:
            app.logger.info(f"Initializing pipeline for language: {lang_code}")
            
            # Create pipeline
            pipeline = KPipeline(lang_code=lang_code)
            
            # Move pipeline models to the detected device if GPU is selected
            if DEVICE == "cuda" and hasattr(pipeline, 'model'):
                try:
                    if hasattr(pipeline.model, 'to'):
                        pipeline.model.to(DEVICE)
                        app.logger.info(f"Moved pipeline model to {DEVICE}")
                        
                except Exception as e:
                    app.logger.error(f"Failed to move model to {DEVICE}, falling back to CPU: {e}")
                    # Force CPU mode
                    torch.set_default_tensor_type('torch.FloatTensor')
                    # Note: We can't modify global variables here easily, 
                    # but the pipeline will still work on CPU
            
            pipelines[lang_code] = pipeline
            
        return pipelines[lang_code]
    except Exception as e:
        app.logger.error(f"Error initializing pipeline for language {lang_code}: {e}")
        raise

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    try:
        # Attempt to get a pipeline for a default language to check readiness
        get_pipeline('a')
        app.logger.info("Health check successful.")
        
        # Get system information
        cpu_count = multiprocessing.cpu_count()
        memory_info = "N/A"
        
        if DEVICE == "cuda":
            try:
                gpu_memory_used = torch.cuda.memory_allocated(0) / (1024**3)  # GB
                gpu_memory_total = torch.cuda.get_device_properties(0).total_memory / (1024**3)  # GB
                memory_info = f"{gpu_memory_used:.1f}GB / {gpu_memory_total:.1f}GB VRAM used"
            except:
                memory_info = "GPU memory info unavailable"
        
        return jsonify({
            'status': 'healthy',
            'message': 'Kokoro TTS Server is running',
            'device': DEVICE_INFO,
            'memory_info': memory_info,
            'cpu_cores': cpu_count,
            'torch_threads': torch.get_num_threads() if DEVICE == "cpu" else "N/A (GPU mode)",
            'available_languages': ['a', 'b', 'e', 'f', 'h', 'i', 'j', 'p', 'z'],
            'available_voices': list(VOICE_MAPPING.keys()),
            'device_details': DEVICE_DETAILS
        }), 200
    except Exception as e:
        app.logger.error(f"Health check failed: {e}")
        return jsonify({
            'status': 'unhealthy',
            'message': f'Server is not ready. Please check server logs for details: {e}'
        }), 503

@app.route('/generate', methods=['POST'])
def generate_speech():
    """Generate speech from text."""
    app.logger.info("Received request for speech generation.")
    try:
        data = request.get_json()

        if not data:
            app.logger.warning("No JSON data provided in request.")
            return jsonify({'error': 'No JSON data provided'}), 400

        # Extract parameters with default values
        text = data.get('text', '').strip()
        voice = data.get('voice', 'af_heart')
        speed = float(data.get('speed', 1.0))
        language = data.get('language', 'a')

        if not text:
            app.logger.warning("No text provided for speech generation.")
            return jsonify({'error': 'No text provided for speech generation'}), 400

        app.logger.info(f"Generating speech for text (first 50 chars): '{text[:50]}...' "
                        f"with voice '{voice}', speed {speed}, language '{language}' on {DEVICE.upper()}")

        # Validate voice against known mapping
        if voice not in VOICE_MAPPING:
            app.logger.warning(f"Invalid voice requested: {voice}. Falling back to default 'af_heart'.")
            voice = 'af_heart'

        # Validate language against known supported languages
        supported_languages = ['a', 'b', 'e', 'f', 'h', 'i', 'j', 'p', 'z']
        if language not in supported_languages:
            app.logger.warning(f"Invalid language requested: {language}. Falling back to default 'a'.")
            language = 'a'

        pipeline = get_pipeline(language)
        app.logger.info(f"Successfully obtained pipeline for language: {language}.")

        # Generate audio segments using the pipeline
        audio_segments = []
        
        # Use torch.no_grad() for inference to save memory
        with torch.no_grad():
            start_time = time.time()
            
            for i, (graphemes, phonemes, audio) in enumerate(pipeline(text, voice=voice, speed=speed, split_pattern=r'\n+')):
                # Move audio to CPU if it's on GPU (for final processing)
                if hasattr(audio, 'device') and audio.device.type != 'cpu':
                    audio = audio.cpu()
                
                audio_segments.append(audio)
                app.logger.debug(f"Generated audio segment {i} for graphemes: {graphemes}")
            
            generation_time = time.time() - start_time
            app.logger.info(f"Audio generation completed in {generation_time:.2f}s")

        if not audio_segments:
            app.logger.error("Speech generation yielded no audio segments.")
            return jsonify({'error': 'Failed to generate any audio segments. Check server logs.'}), 500

        # Concatenate all generated audio segments into a single tensor
        if len(audio_segments) > 1:
            full_audio = torch.cat(audio_segments, dim=-1)
            app.logger.info(f"Concatenated {len(audio_segments)} audio segments into one.")
        else:
            full_audio = audio_segments[0]
            app.logger.info("Generated a single audio segment.")

        # Save the combined audio to a BytesIO object in WAV format
        output_buffer = io.BytesIO()
        sf.write(output_buffer, full_audio.numpy(), 22050, format='wav')
        output_buffer.seek(0)

        app.logger.info("Speech generation successful. Sending WAV audio file.")
        return send_file(output_buffer, mimetype='audio/wav', as_attachment=False, download_name='speech.wav')

    except Exception as e:
        app.logger.exception(f"An unexpected error occurred during speech generation: {e}")
        return jsonify({'error': f'An internal server error occurred: {e}'}), 500

@app.route('/stream', methods=['POST'])
def stream_speech():
    """Stream speech generation."""
    try:
        data = request.get_json()
        text = data.get('text', '').strip()
        voice = data.get('voice', 'af_heart')
        speed = float(data.get('speed', 1.0))
        language = data.get('language', 'a')

        if not text:
            return jsonify({'error': 'No text provided'}), 400

        pipeline = get_pipeline(language)
        
        def generate():
            try:
                with torch.no_grad():
                    for i, (_, _, audio) in enumerate(
                        pipeline(text, voice=voice, speed=speed, split_pattern=r'\n+') 
                    ):
                        # Convert to raw PCM (16-bit, 22.05kHz, mono)
                        if hasattr(audio, 'device') and audio.device.type != 'cpu':
                            audio = audio.cpu()
                        pcm_data = (audio.numpy() * 32767).astype('int16').tobytes()
                        yield pcm_data
            except Exception as e:
                app.logger.error(f"Streaming error: {e}")

        return Response(generate(), mimetype='audio/x-raw')
    
    except Exception as e:
        app.logger.exception(f"Streaming failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/system-info', methods=['GET'])
def system_info():
    """Get detailed system information."""
    try:
        info = {
            'device': DEVICE,
            'device_info': DEVICE_INFO,
            'cpu_cores': multiprocessing.cpu_count(),
            'torch_version': torch.__version__,
            'device_details': DEVICE_DETAILS
        }
        
        if DEVICE == "cpu":
            info['torch_threads'] = torch.get_num_threads()
            info['torch_interop_threads'] = torch.get_num_interop_threads()
            info['mkldnn_enabled'] = torch.backends.mkldnn.is_available() if hasattr(torch.backends, 'mkldnn') else False
            
        elif DEVICE == "cuda":
            info['cuda_version'] = torch.version.cuda
            info['gpu_count'] = torch.cuda.device_count()
            info['current_gpu'] = torch.cuda.current_device()
            try:
                info['gpu_memory_allocated'] = f"{torch.cuda.memory_allocated(0) / (1024**3):.2f} GB"
                info['gpu_memory_total'] = f"{torch.cuda.get_device_properties(0).total_memory / (1024**3):.2f} GB"
            except:
                info['gpu_memory_info'] = "Memory info unavailable"
                
        return jsonify(info), 200
        
    except Exception as e:
        app.logger.error(f"Error getting system info: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/force-cpu', methods=['POST'])
def force_cpu_mode():
    """Force CPU mode even if GPU is available."""
    try:
        # Clear existing pipelines
        pipelines.clear()
        torch.cuda.empty_cache() if torch.cuda.is_available() else None
        
        # Force CPU configuration
        cpu_count = multiprocessing.cpu_count()
        optimal_threads = max(1, min(cpu_count, 16))
        
        torch.set_num_threads(optimal_threads)
        torch.set_num_interop_threads(optimal_threads)
        torch.set_default_tensor_type('torch.FloatTensor')
        
        if hasattr(torch.backends, 'mkldnn'):
            torch.backends.mkldnn.enabled = True
        
        # Update global variables
        global DEVICE, DEVICE_INFO
        DEVICE = "cpu"
        DEVICE_INFO = f"CPU: {cpu_count} cores (forced mode, using {optimal_threads} threads)"
        
        app.logger.info(f"Forced CPU mode: {DEVICE_INFO}")
        
        return jsonify({
            'status': 'success',
            'message': 'Switched to CPU mode',
            'device': DEVICE_INFO
        }), 200
        
    except Exception as e:
        app.logger.error(f"Error forcing CPU mode: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Initialize a default pipeline on server startup for faster first request
    try:
        get_pipeline('a')
        app.logger.info("Default 'a' language pipeline initialized on startup.")
    except Exception as e:
        app.logger.error(f"Failed to initialize default pipeline on startup: {e}")

    # Run the Flask application
    app.run(host='0.0.0.0', port=8000, debug=False, threaded=True)
