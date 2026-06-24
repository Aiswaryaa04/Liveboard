from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import json

app = FastAPI(title="LiveBoard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory room registry: room_id -> list of connected WebSocket clients
# (Commit 2 will replace the cross-client broadcast with Redis pub/sub)
rooms: dict[str, list[WebSocket]] = {}


@app.websocket("/ws/{room_id}")
async def room_websocket(websocket: WebSocket, room_id: str):
    await websocket.accept()

    if room_id not in rooms:
        rooms[room_id] = []
    rooms[room_id].append(websocket)

    try:
        while True:
            data = await websocket.receive_text()
            event = json.loads(data)

            # Broadcast this drawing event to every OTHER client in the same room
            for client in rooms[room_id]:
                if client != websocket:
                    await client.send_text(data)

    except WebSocketDisconnect:
        rooms[room_id].remove(websocket)
        if not rooms[room_id]:
            del rooms[room_id]
            