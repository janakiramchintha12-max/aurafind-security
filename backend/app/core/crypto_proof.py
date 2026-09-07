import secrets
import base64
from datetime import datetime, timezone, timedelta
from typing import Dict
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, padding
from cryptography.hazmat.primitives.serialization import load_pem_public_key, load_der_public_key
from cryptography.exceptions import InvalidSignature

# In-memory store for active nonces: nonce -> {"user_id": str, "expires_at": datetime}
active_enrollment_challenges: Dict[str, dict] = {}

def generate_enrollment_challenge(user_id: str) -> dict:
    nonce = secrets.token_hex(24)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    active_enrollment_challenges[nonce] = {
        "user_id": user_id,
        "expires_at": expires_at
    }
    # Clean expired nonces
    now = datetime.now(timezone.utc)
    expired_keys = [k for k, v in active_enrollment_challenges.items() if v["expires_at"] < now]
    for k in expired_keys:
        active_enrollment_challenges.pop(k, None)

    return {
        "nonce": nonce,
        "expires_at": expires_at.isoformat(),
        "user_id": user_id
    }

def verify_proof_of_possession(
    user_id: str,
    device_name: str,
    nonce: str,
    public_key_str: str,
    signature_str: str
) -> bool:
    """
    Verifies cryptographic proof-of-possession for physical APK enrollment:
    1. Checks nonce validity, user binding, and expiration
    2. Reconstructs expected payload: f"{user_id}:{device_name}:{nonce}"
    3. Cryptographically verifies signature against public_key
    4. Burns nonce on first use to prevent replay
    """
    if not nonce or nonce not in active_enrollment_challenges:
        return False

    challenge = active_enrollment_challenges.pop(nonce)
    now = datetime.now(timezone.utc)
    if challenge["expires_at"] < now or challenge["user_id"] != user_id:
        return False

    expected_payload = f"{user_id}:{device_name}:{nonce}".encode("utf-8")

    try:
        # 1. Decode signature (Base64 or Raw Bytes)
        try:
            sig_bytes = base64.b64decode(signature_str)
        except Exception:
            sig_bytes = bytes.fromhex(signature_str)

        # 2. Parse Public Key (PEM or DER)
        pub_key = None
        if "BEGIN PUBLIC KEY" in public_key_str:
            pub_key = load_pem_public_key(public_key_str.encode("utf-8"))
        else:
            try:
                der_bytes = base64.b64decode(public_key_str)
                pub_key = load_der_public_key(der_bytes)
            except Exception:
                # Raw Hex or formatted PEM wrapper
                pem_formatted = f"-----BEGIN PUBLIC KEY-----\n{public_key_str}\n-----END PUBLIC KEY-----"
                pub_key = load_pem_public_key(pem_formatted.encode("utf-8"))

        if isinstance(pub_key, ec.EllipticCurvePublicKey):
            pub_key.verify(sig_bytes, expected_payload, ec.ECDSA(hashes.SHA256()))
            return True
        elif isinstance(pub_key, ed25519.Ed25519PublicKey):
            pub_key.verify(sig_bytes, expected_payload)
            return True
        else:
            return False

    except InvalidSignature:
        return False
    except Exception as e:
        return False
