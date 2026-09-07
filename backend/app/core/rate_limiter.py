import time
from collections import defaultdict
from fastapi import Request, HTTPException, status

# Sliding window rate limiter: key -> list of timestamps
request_history = defaultdict(list)

def rate_limit(max_requests: int = 60, window_seconds: int = 60):
    """
    Fast, memory-efficient sliding-window rate limiter.
    Keyed by client IP + endpoint path or token.
    """
    def dependency(request: Request):
        client_ip = request.client.host if request.client else "unknown"
        path = request.url.path
        key = f"{client_ip}:{path}"

        now = time.time()
        window_start = now - window_seconds

        # Prune older entries
        history = request_history[key]
        request_history[key] = [t for t in history if t > window_start]

        if len(request_history[key]) >= max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded: Maximum {max_requests} requests per {window_seconds}s.",
                headers={"Retry-After": str(window_seconds)}
            )

        request_history[key].append(now)

    return dependency
