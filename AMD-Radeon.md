# ROCm Installation Guide for Kokoro TTS Server

## Prerequisites

### System Requirements
- **Supported GPUs**: AMD ROCm is officially supported only on a few consumer-grade GPUs, mainly Radeon RX 7900 GRE and above, but it can work with other modern AMD GPUs
- **Operating System**: Linux (Ubuntu 20.04+, CentOS 8+, RHEL 8+)
- **Python**: 3.8+

### Supported AMD GPUs (Official)
- RX 7900 XTX, RX 7900 XT, RX 7900 GRE
- RX 6950 XT, RX 6900 XT, RX 6800 XT, RX 6800
- Some Radeon Pro cards
- RDNA2/RDNA3 architecture GPUs

## Installation Steps

### Step 1: Install ROCm Runtime
First, install the ROCm runtime and drivers:

```bash
# Add AMD GPG key and repository (Ubuntu/Debian)
wget -q -O - https://repo.radeon.com/rocm/rocm.gpg.key | sudo apt-key add -
echo 'deb [arch=amd64] https://repo.radeon.com/rocm/apt/debian/ ubuntu main' | sudo tee /etc/apt/sources.list.d/rocm.list

# Update package list
sudo apt update

# Install ROCm
sudo apt install rocm-dev rocm-libs rocm-utils

# Add user to render and video groups
sudo usermod -a -G render,video $USER
```

### Step 2: Install PyTorch with ROCm Support
An installable Python package is now hosted on pytorch.org for ROCm. Install it with:

```bash
# Check ROCm version first
rocm-smi --showproductname

# Install PyTorch with ROCm (replace rocm5.7 with your version)
pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm5.7
```

### Step 3: Verify Installation
Verify if Pytorch is installed and detecting the GPU compute device:

```bash
# Test PyTorch installation
python3 -c 'import torch' 2> /dev/null && echo 'Success' || echo 'Failure'

# Test GPU detection
python3 -c "import torch; print(f'ROCm available: {torch.cuda.is_available()}'); print(f'Device count: {torch.cuda.device_count()}')"
```

### Step 4: Install Your Existing Dependencies
Install the dependencies from your current server:

```bash
pip install flask flask-cors soundfile
pip install kokoro  # Your TTS library
```

## Environment Variables (Optional but Recommended)

Set these environment variables for better compatibility:

```bash
# Add to ~/.bashrc or ~/.profile
export HSA_OVERRIDE_GFX_VERSION=10.3.0  # For unsupported GPU compatibility
export PYTORCH_HIP_ALLOC_CONF=expandable_segments:True
export HSA_FORCE_FINE_GRAIN_PCIE=1
export HIP_VISIBLE_DEVICES=0  # If you have multiple GPUs
```

## Docker Alternative (Easier Option)

If you prefer Docker, you can use a pre-built ROCm container:

```bash
# Pull ROCm PyTorch container
docker pull rocm/pytorch:latest

# Run with GPU access
docker run -it --device=/dev/kfd --device=/dev/dri --group-add video --group-add render rocm/pytorch:latest
```

## Troubleshooting

### Common Issues

1. **GPU Not Detected**: Ensure your GPU is supported and drivers are properly installed
2. **Permission Issues**: Make sure your user is in the `render` and `video` groups
3. **Version Mismatch**: Ensure ROCm and PyTorch versions are compatible

### Testing Commands

```bash
# Check ROCm installation
rocm-smi

# Check if HIP is working
hipconfig --platform

# Test PyTorch with ROCm
python3 -c "import torch; print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'No GPU detected')"
```
