import time
import subprocess
import os
import requests
import sys
import re

BACKEND_DIR = r"C:\Users\janak\Desktop\theft.in\backend"
DASHBOARD_DIR = r"C:\Users\janak\Desktop\theft.in\dashboard"
PROJECT_DIR = r"C:\Users\janak\Desktop\theft.in"

GATEWAY_FILE = r"C:\Users\janak\Desktop\theft.in\backend\app\static\active_gateway.json"

# ============================================================
# HEALTH CHECKS
# ============================================================

def check_backend():
    try:
        res = requests.get(
            "http://127.0.0.1:8000/health",
            timeout=3
        )
        return res.status_code == 200
    except Exception:
        return False


def check_dashboard():
    # Accept the dashboard on either 5173 or 5174.
    # This prevents the watchdog from repeatedly launching Vite.
    for port in (5173, 5174):
        try:
            res = requests.get(
                f"http://127.0.0.1:{port}",
                timeout=3
            )

            if res.status_code == 200:
                return True

        except Exception:
            pass

    return False


# ============================================================
# START SERVICES
# ============================================================

def start_backend():
    print("[WATCHDOG] Starting FastAPI Backend on port 8000...")

    env = os.environ.copy()
    env["PYTHONPATH"] = BACKEND_DIR

    subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            "8000"
        ],
        cwd=BACKEND_DIR,
        env=env,
        creationflags=(
            subprocess.CREATE_NO_WINDOW
            if os.name == "nt"
            else 0
        )
    )


def start_dashboard():
    print("[WATCHDOG] Starting Vite Dashboard...")

    subprocess.Popen(
        [
            "cmd",
            "/c",
            "npm",
            "run",
            "dev"
        ],
        cwd=DASHBOARD_DIR,
        creationflags=(
            subprocess.CREATE_NO_WINDOW
            if os.name == "nt"
            else 0
        )
    )


def start_tunnel():
    print("[WATCHDOG] Starting Cloudflare Tunnel Daemon...")

    subprocess.Popen(
        [
            r"C:\Users\janak\Desktop\theft.in\cloudflared.exe",
            "tunnel",
            "--url",
            "http://127.0.0.1:8000"
        ],
        cwd=PROJECT_DIR,
        creationflags=(
            subprocess.CREATE_NO_WINDOW
            if os.name == "nt"
            else 0
        )
    )


# ============================================================
# CLOUDFLARE TUNNEL DISCOVERY
# ============================================================

def update_remote_gateway_discovery():

    try:
        res = requests.get(
            "http://127.0.0.1:20241/metrics",
            timeout=3
        )

        match = re.search(
            r'user_user_tunnel_user_url="([^"]+)"',
            res.text
        )

        if match:

            url = match.group(1)

            print(
                f"[WATCHDOG] Active Tunnel URL Discovered: {url}"
            )

            os.makedirs(
                os.path.dirname(GATEWAY_FILE),
                exist_ok=True
            )

            with open(
                GATEWAY_FILE,
                "w",
                encoding="utf-8"
            ) as f:

                f.write(
                    f'{{"active_url": "{url}"}}'
                )

    except Exception:
        pass


# ============================================================
# WATCHDOG
# ============================================================

def run_watchdog():

    print("==========================================================")
    print("🛡️ AuraFind Zero-Touch Auto-Discovery Watchdog Active")
    print("==========================================================")

    while True:

        try:

            # ------------------------------------------------
            # BACKEND
            # ------------------------------------------------

            if not check_backend():

                print(
                    "[WATCHDOG WARNING] "
                    "Backend server offline!"
                )

                print(
                    "[WATCHDOG] "
                    "Self-healing restart triggered..."
                )

                start_backend()

                time.sleep(3)

            # ------------------------------------------------
            # DASHBOARD
            # ------------------------------------------------

            if not check_dashboard():

                print(
                    "[WATCHDOG WARNING] "
                    "Dashboard server offline!"
                )

                print(
                    "[WATCHDOG] "
                    "Self-healing restart triggered..."
                )

                start_dashboard()

                time.sleep(5)

            # ------------------------------------------------
            # TUNNEL DISCOVERY
            # ------------------------------------------------

            update_remote_gateway_discovery()

        except Exception as e:

            print(
                f"[WATCHDOG ERROR] {e}"
            )

        # Check every 10 seconds
        time.sleep(10)


# ============================================================
# MANUAL CHECK MODE
# ============================================================

if __name__ == "__main__":

    if len(sys.argv) > 1 and sys.argv[1] == "--check":

        b_ok = check_backend()
        d_ok = check_dashboard()

        print(
            f"Backend Status: "
            f"{'OK' if b_ok else 'OFFLINE'}"
        )

        print(
            f"Dashboard Status: "
            f"{'OK' if d_ok else 'OFFLINE'}"
        )

    else:

        run_watchdog()