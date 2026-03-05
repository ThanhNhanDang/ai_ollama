"""
Ollama Sidecar — FastAPI service chạy bên trong Ollama container.
Expose /api/system-info trả về RAM, GPU (NVIDIA), Disk info.
Port: 11435
"""
import subprocess
import re
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Ollama Sidecar", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _get_ram() -> dict | None:
    """Read RAM from /proc/meminfo."""
    try:
        with open("/proc/meminfo") as f:
            content = f.read()
        mem = {}
        for line in content.strip().split("\n"):
            parts = line.split()
            if len(parts) >= 2:
                mem[parts[0].rstrip(":")] = int(parts[1])  # kB

        total_kb = mem.get("MemTotal", 0)
        avail_kb = mem.get("MemAvailable", 0)
        if total_kb == 0:
            return None

        total_gb = total_kb / (1024 * 1024)
        avail_gb = avail_kb / (1024 * 1024)
        used_gb = total_gb - avail_gb
        return {
            "total_gb": round(total_gb, 1),
            "available_gb": round(avail_gb, 1),
            "used_gb": round(used_gb, 1),
            "usage_pct": round(used_gb / total_gb * 100) if total_gb > 0 else 0,
        }
    except Exception:
        return None


def _get_gpu() -> dict | None:
    """Query NVIDIA GPU via nvidia-smi."""
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.free,memory.used,utilization.gpu,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None

        parts = [p.strip() for p in result.stdout.strip().split(",")]
        if len(parts) < 4:
            return None

        name = parts[0]
        total_mb = int(parts[1])
        free_mb = int(parts[2])
        used_mb = int(parts[3])
        gpu_util = int(parts[4]) if len(parts) > 4 and parts[4] not in ("", "[N/A]") else None
        temperature = int(parts[5]) if len(parts) > 5 and parts[5] not in ("", "[N/A]") else None

        return {
            "name": name,
            "total_gb": round(total_mb / 1024, 1),
            "free_gb": round(free_mb / 1024, 1),
            "used_gb": round(used_mb / 1024, 1),
            "usage_pct": round(used_mb / total_mb * 100) if total_mb > 0 else 0,
            "gpu_utilization_pct": gpu_util,
            "temperature_c": temperature,
        }
    except FileNotFoundError:
        return None
    except Exception:
        return None


def _get_disk() -> dict | None:
    """Query disk usage for Ollama model directory."""
    try:
        result = subprocess.run(
            ["df", "-h", "/root/.ollama"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            return None

        lines = result.stdout.strip().split("\n")
        if len(lines) < 2:
            return None

        parts = lines[1].split()
        if len(parts) < 5:
            return None

        usage_pct_str = parts[4].rstrip("%")
        # Try to get raw bytes as well
        result_bytes = subprocess.run(
            ["df", "-B1", "/root/.ollama"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        size_gb, used_b_gb, free_b_gb = None, None, None
        if result_bytes.returncode == 0:
            blines = result_bytes.stdout.strip().split("\n")
            if len(blines) >= 2:
                bparts = blines[1].split()
                if len(bparts) >= 4:
                    size_gb = round(int(bparts[1]) / (1024 ** 3), 1)
                    used_b_gb = round(int(bparts[2]) / (1024 ** 3), 1)
                    free_b_gb = round(int(bparts[3]) / (1024 ** 3), 1)

        return {
            "total": parts[1],
            "used": parts[2],
            "free": parts[3],
            "usage_pct": usage_pct_str,
            "total_gb": size_gb,
            "used_gb": used_b_gb,
            "free_gb": free_b_gb,
        }
    except Exception:
        return None


@app.get("/api/system-info")
def system_info():
    """Return RAM, GPU, Disk info from inside the Ollama container."""
    return {
        "ram": _get_ram(),
        "gpu": _get_gpu(),
        "disk": _get_disk(),
    }


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=11435)