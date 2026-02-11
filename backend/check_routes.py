import sys
import os
sys.path.append('/app')
from app.main import app
from fastapi.routing import APIRoute

print("Listing all registered routes:")
for route in app.routes:
    if isinstance(route, APIRoute):
        print(f"{route.methods} {route.path}")
    else:
        print(f"Mount: {route.path}")
